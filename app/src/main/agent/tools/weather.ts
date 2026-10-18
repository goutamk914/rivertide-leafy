/**
 * get_weather — Open-Meteo geocoding + forecast (no key). Only offered when
 * `settings.agent.allowNetworkTools` is on. Every response is validated with zod.
 */
import { z } from 'zod';
import { defineTool, fail, ok, type AgentTool } from './types';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 8000;
const FAHRENHEIT_REGIONS: ReadonlySet<string> = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW']);

const GeocodeSchema = z.object({
  results: z.array(z.object({
    name: z.string(), latitude: z.number(), longitude: z.number(),
    country: z.string().optional(), admin1: z.string().optional(),
  })).optional(),
});

const ForecastSchema = z.object({
  current: z.object({ temperature_2m: z.number(), weather_code: z.number(), wind_speed_10m: z.number().optional() }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()).optional(),
  }),
});

/** WMO weather interpretation codes → plain words. */
export function describeWeatherCode(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzly';
  if (code >= 61 && code <= 67) return 'rainy';
  if (code >= 71 && code <= 77) return 'snowy';
  if (code >= 80 && code <= 82) return 'showery';
  if (code === 85 || code === 86) return 'snow showers';
  if (code >= 95) return 'stormy';
  return 'mixed';
}

export const defaultUnits = (locale: string = Intl.DateTimeFormat().resolvedOptions().locale): 'celsius' | 'fahrenheit' => {
  const region = /[-_]([A-Z]{2})\b/.exec(locale)?.[1] ?? '';
  return FAHRENHEIT_REGIONS.has(region) ? 'fahrenheit' : 'celsius';
};

async function getJson(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const schema = z.object({
  location: z.string().trim().min(1).max(100).describe('City or place, e.g. "Seattle" or "Paris, France".'),
  days: z.number().int().min(1).max(3).optional().describe('1 = today only (default), up to 3.'),
  units: z.enum(['celsius', 'fahrenheit']).optional(),
});

export function createWeatherTool(fetchImpl: typeof fetch = fetch): AgentTool<typeof schema> {
  return defineTool({
    name: 'get_weather',
    description: 'Current weather and the forecast for a place (Open-Meteo). Ask which city if you don’t know where they are.',
    risk: 'read',
    network: true,
    egress: true,
    schema,
    title: ({ location }) => `Weather in ${location}`,
    async run({ location, days, units }, context) {
      try {
        const geo = GeocodeSchema.parse(await getJson(fetchImpl, `${GEOCODE_URL}?name=${encodeURIComponent(location)}&count=1&language=en&format=json`, context.signal));
        const place = geo.results?.[0];
        if (!place) return fail(`I couldn’t find a place called ${location}.`);
        const unit = units ?? defaultUnits();
        const params = new URLSearchParams({
          latitude: String(place.latitude), longitude: String(place.longitude), timezone: 'auto', forecast_days: String(days ?? 1),
          current: 'temperature_2m,weather_code,wind_speed_10m',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
          temperature_unit: unit, wind_speed_unit: unit === 'fahrenheit' ? 'mph' : 'kmh',
        });
        const forecast = ForecastSchema.parse(await getJson(fetchImpl, `${FORECAST_URL}?${params.toString()}`, context.signal));
        const symbol = unit === 'fahrenheit' ? '°F' : '°C';
        const rain = forecast.daily.precipitation_probability_max?.[0];
        const summary = `In ${place.name} it’s ${Math.round(forecast.current.temperature_2m)}${symbol} and ${describeWeatherCode(forecast.current.weather_code)}. `
          + `Today’s high is ${Math.round(forecast.daily.temperature_2m_max[0])}°, low ${Math.round(forecast.daily.temperature_2m_min[0])}°`
          + `${rain !== undefined && rain !== null ? `, with a ${rain}% chance of rain` : ''}.`;
        return ok(summary, { place: [place.name, place.admin1, place.country].filter(Boolean).join(', '), units: unit, current: forecast.current, daily: forecast.daily });
      } catch (error) {
        if (context.signal.aborted) return fail('Stopped.');
        return fail('I couldn’t get the weather just now. Check your internet connection.', { cause: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}
