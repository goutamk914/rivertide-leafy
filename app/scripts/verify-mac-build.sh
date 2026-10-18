#!/usr/bin/env bash
# Checks a packaged Rivertide.app before it ships (used locally and by .github/workflows/release.yml):
#   - the main executable and the native helper are universal (arm64 + x86_64)
#   - the app and every nested binary (the helper included) pass a strict, deep signature check
#   - the app carries entitlements.mac.plist and the Info.plist names/usage strings
#   - the hardening fuses are flipped and the asar integrity hash is embedded
#   - app.asar holds a production (not `npm run dev`) build of the main process
#   - electron-updater's app-update.yml points at GitHub releases
# --release    also requires a Developer ID signature with hardened runtime (app and helper), a
#              stapled notarization ticket and Gatekeeper acceptance
# --artifacts  also runs every check on the app inside release/*.zip (what auto-update installs) and
#              release/*.dmg (what people download)
# --launch     also starts the app with a throwaway data folder and waits until the main process,
#              the native helper and the audio engine report ready, then kills it
#
# Usage: bash scripts/verify-mac-build.sh [--release] [--artifacts] [--launch] [path/to/Rivertide.app]
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "verify-mac-build: macOS only" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$APP_DIR/release"
FUSES_CLI="$APP_DIR/../node_modules/.bin/electron-fuses"
ASAR_CLI="$APP_DIR/../node_modules/.bin/asar"
LOG_FILE="$HOME/Library/Logs/Rivertide/rivertide.log"
LAUNCH_TIMEOUT_S=60
DISABLED_FUSES=(RunAsNode EnableNodeCliInspectArguments EnableNodeOptionsEnvironmentVariable GrantFileProtocolExtraPrivileges)
ENABLED_FUSES=(EnableCookieEncryption EnableEmbeddedAsarIntegrityValidation OnlyLoadAppFromAsar)
READY_MARKERS=('"msg":"Rivertide ready"' '"msg":"native helper ready"' '"msg":"engine ready"')

MODE="adhoc"
CHECK_ARTIFACTS=false
LAUNCH=false
APP=""
for arg in "$@"; do
  case "$arg" in
    --release) MODE="release" ;;
    --artifacts) CHECK_ARTIFACTS=true ;;
    --launch) LAUNCH=true ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) APP="$arg" ;;
  esac
done
APP="${APP:-$RELEASE_DIR/mac-universal/Rivertide.app}"
WORK_DIR="$(mktemp -d)"
DMG_MOUNT=""

cleanup() {
  if [[ -n "$DMG_MOUNT" ]]; then hdiutil detach "$DMG_MOUNT" -quiet || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() { echo "✗ $*" >&2; exit 1; }
pass() { echo "  ✓ $*"; }
plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true; }

check_universal() {
  local archs
  archs="$(lipo -archs "$1" 2>&1)" || fail "$2: lipo failed ($archs)"
  [[ "$archs" == *arm64* && "$archs" == *x86_64* ]] || fail "$2 is not universal ($archs)"
  pass "$2 is universal ($archs)"
}

check_signatures() {
  local app="$1" output
  output="$(codesign --verify --deep --strict --verbose=2 "$app" 2>&1)" || { echo "$output" >&2; fail "app signature is invalid"; }
  output="$(codesign --verify --strict "$app/Contents/Resources/native/rivertide-helper" 2>&1)" \
    || { echo "$output" >&2; fail "rivertide-helper is not signed"; }
  pass "app and nested binaries pass codesign --verify --deep --strict"
  codesign -d --entitlements - --xml "$app" 2>/dev/null | grep -q "com.apple.security.device.audio-input" \
    || fail "app is missing the entitlements from resources/entitlements.mac.plist"
  pass "app carries entitlements.mac.plist"
}

check_info_plist() {
  local app="$1"
  [[ "$(plist "$app" CFBundleIdentifier)" == "org.codethecure.rivertide" ]] || fail "unexpected CFBundleIdentifier"
  [[ "$(plist "$app" CFBundleName)" == "Rivertide" ]] || fail "unexpected CFBundleName"
  [[ -n "$(plist "$app" NSMicrophoneUsageDescription)" ]] || fail "NSMicrophoneUsageDescription is missing"
  [[ -n "$(plist "$app" ElectronAsarIntegrity)" ]] || fail "ElectronAsarIntegrity is missing (asar integrity fuse would fail)"
  pass "Info.plist: org.codethecure.rivertide, \"Rivertide\", microphone usage text, asar integrity"
}

check_fuses() {
  local fuses fuse
  [[ -x "$FUSES_CLI" ]] || fail "@electron/fuses CLI not found at $FUSES_CLI (run npm install)"
  fuses="$("$FUSES_CLI" read --app "$1" 2>&1)" || fail "could not read fuses: $fuses"
  for fuse in "${DISABLED_FUSES[@]}"; do
    grep -q "$fuse is Disabled" <<<"$fuses" || fail "fuse $fuse is not disabled"
  done
  for fuse in "${ENABLED_FUSES[@]}"; do
    grep -q "$fuse is Enabled" <<<"$fuses" || fail "fuse $fuse is not enabled"
  done
  pass "fuses: ${DISABLED_FUSES[*]} off; ${ENABLED_FUSES[*]} on"
}

# `npm run dev` rewrites dist-electron/ as a development bundle; packaging that by mistake would ship
# an app that uses the "Rivertide Dev" data folder. esbuild folds `isDev` to a constant.
check_production_bundle() {
  local out
  out="$(mktemp -d "$WORK_DIR/bundle.XXXX")"
  (cd "$out" && "$ASAR_CLI" extract-file "$1/Contents/Resources/app.asar" dist-electron/main.cjs) \
    || fail "could not read dist-electron/main.cjs from app.asar"
  grep -Eq 'isDev = (false|!1)' "$out/main.cjs" \
    || fail "app.asar holds a development build of the main process (run npm run build, then package)"
  pass "main process bundle is a production build"
}

check_update_config() {
  local config="$1/Contents/Resources/app-update.yml"
  [[ -f "$config" ]] || fail "app-update.yml is missing (electron-updater would stay idle)"
  grep -q "repo: rivertide-electron" "$config" && grep -q "owner: CodeTheCure" "$config" \
    || fail "app-update.yml does not point at CodeTheCure/rivertide-electron"
  pass "app-update.yml → github CodeTheCure/rivertide-electron"
}

check_developer_id() {
  local details
  details="$(codesign -dv --verbose=4 "$1" 2>&1)" || fail "$2: codesign could not read the signature ($details)"
  grep -q "Authority=Developer ID Application" <<<"$details" || fail "$2 is not signed with a Developer ID Application certificate"
  grep -Eq "flags=0x[0-9a-f]*\(.*runtime" <<<"$details" || fail "$2 is not signed with the hardened runtime"
  grep -q "Timestamp=" <<<"$details" || fail "$2 has no secure timestamp"
  pass "$2: Developer ID, hardened runtime, secure timestamp"
}

check_notarized() {
  local output
  output="$(xcrun stapler validate "$1" 2>&1)" || fail "no stapled notarization ticket ($output)"
  output="$(spctl --assess --type execute --verbose=4 "$1" 2>&1)" || true
  grep -q "source=Notarized Developer ID" <<<"$output" || fail "Gatekeeper does not accept the app as Notarized Developer ID ($output)"
  pass "notarized, stapled and accepted by Gatekeeper"
}

verify_app() {
  local app="$1"
  [[ -d "$app" ]] || fail "no app at $app (run npm run dist:adhoc or npm run dist:signed first)"
  echo "Verifying $2 ($MODE)"
  check_universal "$app/Contents/MacOS/Rivertide" "Rivertide"
  check_universal "$app/Contents/Resources/native/rivertide-helper" "rivertide-helper"
  check_signatures "$app"
  check_info_plist "$app"
  check_fuses "$app"
  check_production_bundle "$app"
  check_update_config "$app"
  if [[ "$MODE" == "release" ]]; then
    check_developer_id "$app" "Rivertide.app"
    check_developer_id "$app/Contents/Resources/native/rivertide-helper" "rivertide-helper"
    check_notarized "$app"
  fi
}

only_file() {
  local matches=("$RELEASE_DIR"/$1)
  [[ ${#matches[@]} -eq 1 && -f "${matches[0]}" ]] || fail "expected exactly one release/$1, found: ${matches[*]}"
  echo "${matches[0]}"
}

verify_artifacts() {
  local zip dmg
  zip="$(only_file '*-mac-universal.zip')"
  ditto -x -k "$zip" "$WORK_DIR/zip" || fail "could not unpack $zip"
  verify_app "$WORK_DIR/zip/Rivertide.app" "$(basename "$zip")"
  dmg="$(only_file '*-mac-universal.dmg')"
  DMG_MOUNT="$WORK_DIR/dmg"
  hdiutil attach "$dmg" -nobrowse -readonly -noautoopen -mountpoint "$DMG_MOUNT" -quiet || fail "could not mount $dmg"
  verify_app "$DMG_MOUNT/Rivertide.app" "$(basename "$dmg")"
}

# Every marker after the first `"isDev":false` start line written since line `$1` of the log.
launch_ready() {
  local recent marker
  recent="$(tail -n +"$(($1 + 1))" "$LOG_FILE" 2>/dev/null | sed -n '/"isDev":false.*"Rivertide starting"/,$p')"
  for marker in "${READY_MARKERS[@]}"; do
    grep -qF "$marker" <<<"$recent" || return 1
  done
}

stop_launched() {
  pkill -KILL -P "$1" || true
  kill -KILL "$1" 2>/dev/null || true
  { wait "$1"; } 2>/dev/null || true
}

smoke_launch() {
  local app="$1" start=0 pid second
  [[ -f "$LOG_FILE" ]] && start="$(wc -l <"$LOG_FILE" | tr -d ' ')"
  echo "Launching $app"
  "$app/Contents/MacOS/Rivertide" --user-data-dir="$WORK_DIR/user-data" >/dev/null 2>&1 &
  pid=$!
  for ((second = 0; second < LAUNCH_TIMEOUT_S; second++)); do
    if launch_ready "$start"; then
      stop_launched "$pid"
      pass "launched: main process, native helper and audio engine ready in ~${second}s"
      return 0
    fi
    kill -0 "$pid" 2>/dev/null || fail "Rivertide exited during launch (see $LOG_FILE and Console crash reports)"
    sleep 1
  done
  stop_launched "$pid"
  fail "Rivertide did not report ready within ${LAUNCH_TIMEOUT_S}s (see $LOG_FILE)"
}

verify_app "$APP" "$APP"
if [[ "$CHECK_ARTIFACTS" == true ]]; then verify_artifacts; fi
if [[ "$LAUNCH" == true ]]; then smoke_launch "$APP"; fi
echo "All checks passed."
