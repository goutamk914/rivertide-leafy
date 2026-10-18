import { useCallback, useRef, useState, type DragEvent } from 'react';
import { errorMessage, invoke } from '../../../lib/ipc';
import { toast } from '../../../ui/components';
import { checkDroppedFile, MAX_IMPORT_CHARS, safeDocumentName } from './files';

export interface DropImport {
  readonly dragging: boolean;
  readonly importing: boolean;
  readonly handlers: {
    readonly onDragEnter: (event: DragEvent) => void;
    readonly onDragOver: (event: DragEvent) => void;
    readonly onDragLeave: (event: DragEvent) => void;
    readonly onDrop: (event: DragEvent) => void;
  };
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

async function importFile(file: File): Promise<string | null> {
  const verdict = checkDroppedFile(file.name, file.size, file.type);
  if (!verdict.ok) return verdict.reason;
  const text = await file.text();
  if (!text.trim()) return `${file.name} is empty.`;
  if (text.length > MAX_IMPORT_CHARS) return `${file.name} is too large to add. Split it into smaller files and try again.`;
  await invoke('documents:importText', { name: safeDocumentName(file.name), text });
  return null;
}

/** Drag-and-drop of text files onto the page. Files are read here and sent to main as text. */
export function useDropImport(onImported: () => void): DropImport {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const depth = useRef(0);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setImporting(true);
      (async () => {
        let added = 0;
        for (const file of files) {
          try {
            const problem = await importFile(file);
            if (problem) toast.error(problem);
            else added += 1;
          } catch (error) {
            toast.error(`${file.name} wasn’t added. ${errorMessage(error)}`);
          }
        }
        if (added > 0) {
          toast.success(added === 1 ? 'Document added.' : `${added} documents added.`);
          onImported();
        }
        setImporting(false);
      })();
    },
    [onImported],
  );

  return {
    dragging,
    importing,
    handlers: {
      onDragEnter: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (event) => {
        if (hasFiles(event)) event.preventDefault();
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop,
    },
  };
}
