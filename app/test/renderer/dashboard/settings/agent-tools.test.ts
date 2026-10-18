import { describe, expect, it } from 'vitest';
import {
  AGENT_TOOLS, defaultPolicy, effectivePolicy, findTool, toolsByRisk, withToolPolicy,
} from '../../../../src/renderer/dashboard/pages/settings/model/agent-tools';

const tool = (id: string) => {
  const found = findTool(id);
  if (!found) throw new Error(`missing tool ${id}`);
  return found;
};

describe('AGENT_TOOLS', () => {
  it('lists every tool once with a plain name and description', () => {
    // Arrange
    const ids = AGENT_TOOLS.map((t) => t.id);

    // Act
    const unique = new Set(ids);

    // Assert
    expect(unique.size).toBe(ids.length);
    expect(ids.length).toBe(33);
    expect(AGENT_TOOLS.every((t) => t.name.length > 0 && t.description.length > 0)).toBe(true);
  });

  it('marks the tools that need a yes and the read-only tools', () => {
    // Arrange + Act
    const confirm = toolsByRisk('confirm').map((t) => t.id);
    const read = toolsByRisk('read').map((t) => t.id);

    // Assert
    expect(confirm).toEqual(['quit_app', 'lock_screen', 'sleep_display', 'type_text', 'run_shortcut']);
    expect(read).toHaveLength(11);
    expect(read).toContain('get_weather');
    expect(toolsByRisk('act')).toHaveLength(17);
  });

  it('flags the tools that use the internet', () => {
    // Arrange + Act
    const network = AGENT_TOOLS.filter((t) => t.network).map((t) => t.id);

    // Assert
    expect(network.sort()).toEqual(['get_weather', 'open_url', 'web_search']);
  });
});

describe('tool policy', () => {
  it('defaults read and act tools to always, confirm tools to ask', () => {
    // Arrange + Act + Assert
    expect(defaultPolicy('read')).toBe('always');
    expect(defaultPolicy('act')).toBe('always');
    expect(defaultPolicy('confirm')).toBe('ask');
  });

  it('uses the saved override when there is one', () => {
    // Arrange
    const policies = { open_app: 'never' as const };

    // Act + Assert
    expect(effectivePolicy(tool('open_app'), policies)).toBe('never');
    expect(effectivePolicy(tool('lock_screen'), policies)).toBe('ask');
  });

  it('stores an override without touching the original record', () => {
    // Arrange
    const policies = { web_search: 'ask' as const };

    // Act
    const next = withToolPolicy(policies, tool('quit_app'), 'never');

    // Assert
    expect(next).toEqual({ web_search: 'ask', quit_app: 'never' });
    expect(policies).toEqual({ web_search: 'ask' });
  });

  it('drops the override when the choice matches the default', () => {
    // Arrange
    const policies = { quit_app: 'never' as const, mystery_tool: 'ask' as const };

    // Act
    const next = withToolPolicy(policies, tool('quit_app'), 'ask');

    // Assert
    expect(next).toEqual({ mystery_tool: 'ask' });
  });
});
