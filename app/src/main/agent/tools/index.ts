/** The full agent tool set (ARCHITECTURE §3.9) and helpers to expose it to providers. */
import type { Settings } from '../../../shared/settings';
import type { ToolSpec } from '../../ai/llm/types';
import { openAppTool, quitAppTool } from './apps';
import { copyToClipboardTool, readClipboardTool, typeTextTool } from './clipboard';
import { openFileTool, revealFileTool, searchFilesTool } from './files';
import {
  createNoteTool, recallFactsTool, rememberFactTool, searchDocumentsTool, searchHistoryTool, searchNotesTool,
} from './memory';
import { cancelReminderTool, createReminderTool, listRemindersTool, setTimerTool } from './reminders';
import { openRivertideTool, startDictationTool } from './rivertide';
import { toProviderSchema } from './schema';
import { listShortcutsTool, runShortcutTool } from './shortcuts';
import {
  getSystemStatusTool, lockScreenTool, mediaControlTool, openSystemSettingsTool, setDarkModeTool, setVolumeTool,
  sleepDisplayTool, takeScreenshotTool,
} from './system';
import type { AgentTool } from './types';
import { createWeatherTool } from './weather';
import { composeEmailTool, openUrlTool, webSearchTool } from './web';

export type AnyTool = AgentTool;

export function createAllTools(fetchImpl?: typeof fetch): readonly AnyTool[] {
  return [
    openAppTool, quitAppTool, openUrlTool, webSearchTool, searchFilesTool, openFileTool, revealFileTool,
    getSystemStatusTool, setVolumeTool, setDarkModeTool, mediaControlTool, lockScreenTool, sleepDisplayTool,
    takeScreenshotTool, setTimerTool, createReminderTool, listRemindersTool, cancelReminderTool,
    createNoteTool, searchNotesTool, rememberFactTool, recallFactsTool, searchDocumentsTool, searchHistoryTool,
    copyToClipboardTool, readClipboardTool, typeTextTool, composeEmailTool, runShortcutTool, listShortcutsTool,
    openSystemSettingsTool, openRivertideTool, startDictationTool, createWeatherTool(fetchImpl),
  ] as readonly AnyTool[];
}

/** Tools the model may see: network tools only when allowed, and never tools the user blocked. */
export function availableTools(tools: readonly AnyTool[], settings: Settings): readonly AnyTool[] {
  return tools.filter((tool) => (!tool.network || settings.agent.allowNetworkTools) && settings.agent.toolPolicy[tool.name] !== 'never');
}

export function toToolSpecs(tools: readonly AnyTool[]): readonly ToolSpec[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: toProviderSchema(tool.schema) }));
}
