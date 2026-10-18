import { useCallback, useMemo, useState } from 'react';
import { FileText, Lock, Trash2, Upload } from 'lucide-react';
import type { DocumentMeta } from '@shared/types';
import { formatChars, formatDateTime } from '../../../lib/format';
import { errorMessage, invoke } from '../../../lib/ipc';
import { navigate } from '../../../lib/router';
import { Button, EmptyState, ICON_STROKE, Skeleton, SkeletonList, toast } from '../../../ui/components';
import { useCalm } from '../../app-context';
import { useIpcQuery, useNow } from '../../hooks/useIpc';
import { useItemLookup, useMissingItem } from '../../hooks/useMissingItem';
import { useUndoableDelete } from '../../hooks/useUndoableDelete';
import { byDataId, focusSoon, neighbourOf } from '../../lib/focus';
import { Page, PageError, type PageComponentProps } from '../../shell/Page';
import { kindLabel } from './files';
import { useDropImport } from './useDropImport';
import './documents.css';

const DOC_ID_ATTR = 'data-doc-id';
const IMPORT_BUTTON_ID = 'documents-import';
export const MISSING_DOCUMENT = 'That document isn’t here any more. It may have been deleted.';
const lookupDocument = (id: string) => invoke('documents:get', { id }).then((doc) => doc?.meta ?? null);

function Viewer({ meta, onDelete }: { readonly meta: DocumentMeta; readonly onDelete: () => void }) {
  const now = useNow();
  const doc = useIpcQuery(() => invoke('documents:get', { id: meta.id }), [meta.id]);
  return (
    <article className="doc-viewer" aria-labelledby="doc-title">
      <div className="doc-viewer__head">
        <div>
          <h2 id="doc-title" className="doc-viewer__title">{meta.name}</h2>
          <p className="muted">{kindLabel(meta.kind)} · {formatChars(meta.chars)} · added {formatDateTime(meta.createdAt, now)}</p>
        </div>
        <Button icon={Trash2} variant="danger" onClick={onDelete}>Delete</Button>
      </div>
      {doc.error ? <PageError message={doc.error} onRetry={doc.reload} /> : null}
      {doc.loading ? <Skeleton height={240} radius={12} /> : null}
      {doc.data === null && !doc.loading ? <p className="muted">This document is no longer available.</p> : null}
      {doc.data ? <div className="doc-viewer__text" role="region" tabIndex={0} aria-label="Document text">{doc.data.text}</div> : null}
    </article>
  );
}

export function DocumentsPage({ route }: PageComponentProps) {
  const calm = useCalm();
  const now = useNow();
  const list = useIpcQuery(() => invoke('documents:list', undefined), [], ['documents']);
  const [picking, setPicking] = useState(false);
  const removal = useUndoableDelete(useCallback((id: string) => invoke('documents:delete', { id }), []));
  const drop = useDropImport(list.reload);
  const docs = useMemo(() => (list.data ?? []).filter((d) => !removal.hidden.has(d.id)), [list.data, removal.hidden]);
  const routeId = route.section && !removal.hidden.has(route.section) ? route.section : null;
  const inList = routeId ? docs.find((d) => d.id === routeId) : undefined;
  // A link to a document that isn't listed yet (just imported) or any more (deleted) is checked directly.
  const lookup = useItemLookup(routeId, list.data !== undefined && !inList, lookupDocument);
  useMissingItem(lookup.status === 'missing', '/documents', MISSING_DOCUMENT);
  const selected = routeId ? inList ?? lookup.item ?? null : docs[0] ?? null;

  const onDelete = (doc: DocumentMeta) => {
    const next = neighbourOf(docs, doc.id);
    removal.remove(doc.id, `Deleted ${doc.name}.`);
    navigate(next ? `/documents/${next.id}` : '/documents', { replace: true });
    focusSoon(...(next ? [byDataId(DOC_ID_ATTR, next.id)] : []), `#${IMPORT_BUTTON_ID}`);
  };

  const pick = async () => {
    setPicking(true);
    try {
      const added = await invoke('documents:pick', undefined);
      if (added.length > 0) {
        toast.success(added.length === 1 ? `Added ${added[0]?.name}.` : `${added.length} documents added.`);
        navigate(`/documents/${added[0]?.id}`, { replace: true });
      }
    } catch (error) {
      toast.error(`The document wasn’t added. ${errorMessage(error)}`);
    } finally {
      setPicking(false);
    }
  };

  const importButton = (id?: string) => (
    <Button id={id} variant="accent" icon={Upload} loading={picking || drop.importing} onClick={() => void pick()}>Import</Button>
  );

  return (
    <Page title="Documents" layout="split" actions={importButton(IMPORT_BUTTON_ID)}>
      <div className="docs" {...drop.handlers}>
        {calm ? null : (
          <p className="docs-note">
            <Lock size={16} strokeWidth={ICON_STROKE} aria-hidden />
            Leafy uses these to answer questions in Chat. They stay on this computer. You can also drop text files here.
          </p>
        )}
        {list.error ? <PageError message={list.error} onRetry={list.reload} /> : (
          <div className="split">
            <section className="split__list" aria-label="Your documents">
              {list.loading ? <div style={{ padding: 8 }}><SkeletonList rows={4} label="Loading documents" /></div> : null}
              {!list.loading && docs.length === 0 ? (
                <EmptyState compact pose="reading" title="No documents yet." action={importButton()}>
                  Add appointment summaries or handouts, and Leafy can answer questions about them.
                </EmptyState>
              ) : null}
              {docs.length > 0 ? (
                <ul className="docs-list">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <button type="button" className="doc-row" aria-current={d.id === selected?.id || undefined} onClick={() => navigate(`/documents/${d.id}`, { replace: true })} {...{ [DOC_ID_ATTR]: d.id }}>
                        <span className="doc-row__icon"><FileText size={18} strokeWidth={ICON_STROKE} aria-hidden /></span>
                        <span>
                          <span className="doc-row__name">{d.name}</span>
                          <span className="doc-row__meta">{kindLabel(d.kind)} · {formatChars(d.chars)} · {formatDateTime(d.createdAt, now)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <section className="split__detail" aria-label="Document">
              {selected ? <Viewer key={selected.id} meta={selected} onDelete={() => onDelete(selected)} /> : null}
            </section>
          </div>
        )}
        {drop.dragging ? <div className="docs-drop" aria-hidden><p>Drop text files to add them</p></div> : null}
      </div>
    </Page>
  );
}
