import { Laptop } from 'lucide-react';
import { DATA_FLOWS } from '@/content/privacy';

/** What goes where, as a plain table. Rows that never leave the Mac carry an icon and words, not colour alone. */
export function DataFlowTable({ caption }: { readonly caption: string }) {
  return (
    <table className="flows">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">What</th>
          <th scope="col">Where it goes</th>
          <th scope="col">Good to know</th>
        </tr>
      </thead>
      <tbody>
        {DATA_FLOWS.map((flow) => (
          <tr key={flow.what}>
            <th scope="row">{flow.what}</th>
            <td>
              {flow.localOnly ? (
                <span className="flows__local">
                  <Laptop size={15} strokeWidth={1.75} aria-hidden="true" />
                  Stays on your Mac
                </span>
              ) : null}
              <span className="flows__where">{flow.where}</span>
            </td>
            <td className="flows__note">{flow.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
