import {
  useEffect,
  useRef,
  useState,
  type FC,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  FileCode2,
  FileText,
  Globe2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import type { SupportedLanguage } from '../types/byteplay';

export interface ProjectFile {
  id: string;
  name: string;
  language: SupportedLanguage;
  content: string;
}

interface FileExplorerProps {
  files: ProjectFile[];
  activeFileId: string;
  onSelectFile: (id: string) => void;
  onAddFile: (name?: string) => void;
  onRenameFile: (id: string, newName: string) => void;
  onDeleteFile: (id: string) => void;
}

export const FileExplorer: FC<FileExplorerProps> = ({
  files,
  activeFileId,
  onSelectFile,
  onAddFile,
  onRenameFile,
  onDeleteFile,
}) => {
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingFileId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingFileId]);

  const cancelEditing = (): void => {
    setEditingFileId(null);
    setDraftName('');
  };

  const cancelAdding = (): void => {
    setIsAddingFile(false);
    setNewFileName('');
  };

  const submitNewFile = (): void => {
    const nextName = newFileName.trim();

    if (!nextName) {
      return;
    }

    onAddFile(nextName);
    cancelAdding();
  };

  const saveName = (fileId: string): void => {
    const nextName = draftName.trim();

    if (nextName) {
      onRenameFile(fileId, nextName);
    }

    cancelEditing();
  };

  const startEditing = (
    file: ProjectFile,
    event: MouseEvent<HTMLButtonElement | HTMLSpanElement>,
  ): void => {
    event.stopPropagation();
    setEditingFileId(file.id);
    setDraftName(file.name);
  };

  const handleEditKeyDown = (
    fileId: string,
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveName(fileId);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  };

  return (
    <aside className="app-sidebar flex h-full w-full flex-col border-r border-theme bg-surface text-secondary select-none">
      <div className="flex items-center justify-between border-b border-theme p-3">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
            Explorer
          </h2>
          <p className="mt-1 text-[10px] text-muted">
            {files.length} file{files.length === 1 ? '' : 's'}
          </p>
        </div>

        {!isAddingFile ? (
          <button
            aria-label="Create new file"
            className="primary-action flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold"
            onClick={() => setIsAddingFile(true)}
            title="Create new file"
            type="button"
          >
            <Plus aria-hidden="true" size={13} />
            New
          </button>
        ) : null}
      </div>

      {isAddingFile ? (
        <form
          className="border-b border-theme p-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitNewFile();
          }}
        >
          <input
            aria-label="New file name"
            autoFocus
            className="input-field w-full rounded border px-2 py-1.5 text-xs outline-none"
            onChange={(event) => setNewFileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelAdding();
              }
            }}
            placeholder="main.c or script.py"
            type="text"
            value={newFileName}
          />
          <div className="mt-2 flex gap-2">
            <button
              className="primary-action rounded px-2 py-1 text-xs font-semibold"
              type="submit"
            >
              Add
            </button>
            <button
              className="secondary-action rounded border px-2 py-1 text-xs"
              onClick={cancelAdding}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div
        aria-label="Project files"
        className="min-h-0 flex-1 overflow-y-auto py-2"
        role="listbox"
      >
        {files.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs italic text-muted">
            No files in this project.
          </p>
        ) : (
          files.map((file) => {
            const isActive = file.id === activeFileId;
            const isEditing = file.id === editingFileId;

            return (
              <div
                aria-selected={isActive}
                className={[
                  'group flex min-h-9 items-center justify-between border-l-2 px-3 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'border-blue-500 bg-surface-raised font-medium text-blue-400'
                    : 'border-transparent text-muted hover:bg-surface-raised hover:text-primary',
                ].join(' ')}
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectFile(file.id);
                  }
                }}
                role="option"
                tabIndex={0}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
                  <FileIcon language={file.language} />

                  {isEditing ? (
                    <input
                      aria-label={`Rename ${file.name}`}
                      className="input-field w-full rounded border px-1 py-0.5 text-xs outline-none"
                      onBlur={() => saveName(file.id)}
                      onChange={(event) => setDraftName(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) =>
                        handleEditKeyDown(file.id, event)
                      }
                      ref={inputRef}
                      type="text"
                      value={draftName}
                    />
                  ) : (
                    <span
                      className="truncate"
                      onDoubleClick={(event) => startEditing(file, event)}
                      title={file.name}
                    >
                      {file.name}
                    </span>
                  )}
                </div>

                {!isEditing ? (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      aria-label={`Rename ${file.name}`}
                      className="icon-action rounded p-1"
                      onClick={(event) => startEditing(file, event)}
                      title={`Rename ${file.name}`}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={13} />
                    </button>

                    <button
                      aria-label={`Delete ${file.name}`}
                      className="icon-action danger rounded p-1"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteFile(file.id);
                      }}
                      title={`Delete ${file.name}`}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={13} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

const FileIcon: FC<{ language: SupportedLanguage }> = ({ language }) => {
  switch (language) {
    case 'c':
    case 'cpp':
      return (
        <FileCode2
          aria-hidden="true"
          className="shrink-0 text-blue-400"
          size={14}
        />
      );

    case 'html':
      return (
        <Globe2
          aria-hidden="true"
          className="shrink-0 text-orange-400"
          size={14}
        />
      );

    case 'python':
      return (
        <FileText
          aria-hidden="true"
          className="shrink-0 text-emerald-400"
          size={14}
        />
      );

    default:
      return (
        <FileCode2
          aria-hidden="true"
          className="shrink-0 text-slate-500"
          size={14}
        />
      );
  }
};

export default FileExplorer;