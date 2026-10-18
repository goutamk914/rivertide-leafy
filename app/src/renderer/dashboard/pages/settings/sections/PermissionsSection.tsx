import { Globe, RotateCcw } from 'lucide-react';
import { Badge, Button, Select, Toggle, type SelectOption } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import {
  POLICY_LABELS, RISK_INFO, RISK_ORDER, defaultPolicy, effectivePolicy, toolsByRisk, withToolPolicy,
  type AgentToolInfo, type ToolPolicies, type ToolPolicy, type ToolRisk,
} from '../model/agent-tools';
import { SectionFrame, SettingGroup } from '../parts/layout';

const POLICIES: readonly ToolPolicy[] = ['always', 'ask', 'never'];

const RISK_EXPLAINED: Readonly<Record<ToolRisk, string>> = {
  read: 'Reads information. Runs without asking unless you change it.',
  act: 'Changes something for you, and shows what it did. Runs without asking unless you change it.',
  confirm: 'Leafy asks first: say yes, press Enter or click to allow it.',
};

function policyOptions(risk: ToolRisk): readonly SelectOption<ToolPolicy>[] {
  const fallback = defaultPolicy(risk);
  return POLICIES.map((p) => ({ value: p, label: p === fallback ? `${POLICY_LABELS[p]} (default)` : POLICY_LABELS[p] }));
}

interface ToolRowProps {
  readonly tool: AgentToolInfo;
  readonly policies: ToolPolicies;
  readonly networkAllowed: boolean;
  readonly onChange: (tool: AgentToolInfo, value: ToolPolicy) => void;
}

function ToolRow({ tool, policies, networkAllowed, onChange }: ToolRowProps) {
  const risk = RISK_INFO[tool.risk];
  const blocked = tool.network && !networkAllowed;
  return (
    <tr>
      <th scope="row" className="settings-tools__name">
        <span className="settings-tools__title">{tool.name}</span>
        <span className="settings-tools__description">{tool.description}</span>
      </th>
      <td>
        <span className="settings-tools__badges">
          <Badge tone={risk.tone}>{risk.label}</Badge>
          {tool.network ? <Badge icon={Globe}>Internet</Badge> : null}
        </span>
      </td>
      <td className="settings-tools__policy">
        <Select
          aria-label={`${tool.name}: when Leafy may use it`}
          options={policyOptions(tool.risk)}
          value={effectivePolicy(tool, policies)}
          disabled={blocked}
          onChange={(value) => onChange(tool, value)}
        />
        {blocked ? <span className="settings-note">Off while internet tools are off</span> : null}
      </td>
    </tr>
  );
}

function ToolTable({ policies, networkAllowed, onChange }: Omit<ToolRowProps, 'tool'>) {
  return (
    <table className="settings-tools">
      <caption className="visually-hidden">What Leafy may do, and when</caption>
      <thead>
        <tr>
          <th scope="col">Tool</th>
          <th scope="col">Kind</th>
          <th scope="col">Allowed</th>
        </tr>
      </thead>
      {RISK_ORDER.map((risk) => (
        <tbody key={risk}>
          <tr className="settings-tools__group">
            <th scope="rowgroup" colSpan={3}>
              <span className="settings-tools__group-title">{RISK_INFO[risk].group}</span>
              <span className="settings-tools__description">{RISK_EXPLAINED[risk]}</span>
            </th>
          </tr>
          {toolsByRisk(risk).map((tool) => (
            <ToolRow key={tool.id} tool={tool} policies={policies} networkAllowed={networkAllowed} onChange={onChange} />
          ))}
        </tbody>
      ))}
    </table>
  );
}

export function PermissionsSection() {
  const { agent } = useSettings();
  const update = useUpdateSettings();
  const policies = agent.toolPolicy;
  const hasOverrides = Object.keys(policies).length > 0;
  // toolPolicy is replaced wholesale, so every change sends the complete record.
  const savePolicies = (toolPolicy: Record<string, ToolPolicy>) => void update({ agent: { toolPolicy } });

  return (
    <SectionFrame
      title="Leafy’s permissions"
      description="Choose what Leafy may do when you give it a command. Rivertide checks these rules itself before every action, so the AI model can’t skip them."
    >
      <SettingGroup title="Internet">
        <Toggle
          label="Allow tools that use the internet"
          description="Web search, weather and opening web pages. When this is off, Leafy won’t use them."
          checked={agent.allowNetworkTools}
          onChange={(allowNetworkTools) => void update({ agent: { allowNetworkTools } })}
        />
      </SettingGroup>
      <SettingGroup
        title="Tools"
        description="Always runs without asking. Ask first waits for your yes. Never blocks the tool."
        actions={
          hasOverrides ? (
            <Button size="sm" variant="quiet" icon={RotateCcw} onClick={() => savePolicies({})}>Use all defaults</Button>
          ) : null
        }
      >
        <ToolTable
          policies={policies}
          networkAllowed={agent.allowNetworkTools}
          onChange={(tool, value) => savePolicies(withToolPolicy(policies, tool, value))}
        />
      </SettingGroup>
    </SectionFrame>
  );
}
