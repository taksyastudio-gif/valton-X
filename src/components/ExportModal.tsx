import {
  Check,
  Download,
  FileArchive,
  Mail,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type MouseEvent,
  type ReactNode,
} from 'react';

import type { FileItem } from '../types/byteplay';

interface ExportModalProps {
  isOpen: boolean;
  activeFile: FileItem | undefined;
  files: FileItem[];
  onClose: () => void;
}

type ExportFormat = 'file' | 'project' | 'email';

interface ExportOptionProps {
  checked: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

interface VlntoxManifest {
  format: 'vlntox-project';
  version: 1;
  createdAt: string;
  entrypoints: {
    web?: string;
  };
  files: Array<{
    path: string;
    language: FileItem['language'];
    isWebProjectFile: boolean;
  }>;
}

interface ZipEntry {
  path: string;
  content: string;
}

interface PreparedZipEntry {
  pathBytes: Uint8Array;
  contentBytes: Uint8Array;
  checksum: number;
  offset: number;
}

const MAX_FILE_COUNT = 100;
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_PROJECT_SIZE = 10 * 1024 * 1024;
const MAX_MAILTO_BODY_BYTES = 60 * 1024;
const MAX_MAILTO_URL_CHARS = 100_000;

const ExportOption: FC<ExportOptionProps> = ({
  checked,
  title,
  description,
  icon,
  disabled = false,
  onSelect,
}) => (
  <button
    aria-checked={checked}
    className={[
      'w-full rounded-lg border p-4 text-left transition-colors',
      checked
        ? 'border-blue-500 bg-blue-500/10'
        : 'border-theme bg-surface-raised hover:border-theme-strong',
      disabled ? 'cursor-not-allowed opacity-50' : '',
    ].join(' ')}
    disabled={disabled}
    onClick={onSelect}
    role="radio"
    type="button"
  >
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={[
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          checked
            ? 'border-blue-400 bg-blue-500 text-white'
            : 'border-theme-strong text-muted',
        ].join(' ')}
      >
        {checked ? <Check size={10} /> : null}
      </span>

      <span className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 text-blue-400">
          {icon}
        </span>

        <span>
          <span className="block text-sm font-semibold text-primary">
            {title}
          </span>

          <span className="mt-1 block text-xs leading-5 text-secondary">
            {description}
          </span>
        </span>
      </span>
    </div>
  </button>
);

export const ExportModal: FC<ExportModalProps> = ({
  isOpen,
  activeFile,
  files,
  onClose,
}) => {
  const [format, setFormat] =
    useState<ExportFormat>('file');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(
    files.map((file) => file.id),
  );
  const previousFileIds = useRef(files.map((file) => file.id));

  const normalizedFiles = useMemo(
    () =>
      files
        .map((file) => ({
          ...file,
          name: normalizeArchivePath(file.name),
        }))
        .filter((file) => file.name.length > 0),
    [files],
  );

  const webEntryPoint = useMemo(
    () =>
      normalizedFiles.find((file) => {
        const lowerName = file.name.toLowerCase();

        return (
          lowerName === 'index.html' ||
          lowerName === 'index.htm' ||
          lowerName === 'main.html'
        );
      })?.name,
    [normalizedFiles],
  );

  const projectBundle = useMemo(
    () =>
      normalizedFiles.filter((file) =>
        selectedFileIds.includes(file.id),
      )
        .map(
          (file) =>
            `===== ${file.name} =====\n\n${file.content}\n\n`,
        )
        .join(''),
    [normalizedFiles, selectedFileIds],
  );

  const selectedFiles = useMemo(
    () =>
      normalizedFiles.filter((file) =>
        selectedFileIds.includes(file.id),
      ),
    [normalizedFiles, selectedFileIds],
  );

  const projectSize = useMemo(
    () =>
      selectedFiles.reduce(
        (total, file) =>
          total +
          new TextEncoder().encode(file.content).byteLength,
        0,
      ),
    [selectedFiles],
  );

  useEffect(() => {
    const currentFileIds = files.map((file) => file.id);
    const addedFileIds = currentFileIds.filter(
      (id) => !previousFileIds.current.includes(id),
    );

    setSelectedFileIds((currentIds) => [
      ...currentIds.filter((id) => currentFileIds.includes(id)),
      ...addedFileIds,
    ]);
    previousFileIds.current = currentFileIds;
  }, [files]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isExporting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener(
        'keydown',
        handleEscape,
      );
    };
  }, [isExporting, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const downloadBlob = (
    filename: string,
    content: BlobPart,
    mimeType: string,
  ): void => {
    const blob = new Blob([content], {
      type: mimeType,
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };

  const validateProject = (
    exportFiles: FileItem[],
  ): string | null => {
    if (exportFiles.length === 0) {
      return 'Select at least one project file to export.';
    }

    if (exportFiles.length > MAX_FILE_COUNT) {
      return `Projects may contain at most ${MAX_FILE_COUNT} files.`;
    }

    if (projectSize > MAX_PROJECT_SIZE) {
      return 'The project is larger than the 10 MB browser export limit.';
    }

    const oversizedFile = exportFiles.find(
      (file) =>
        new TextEncoder().encode(file.content).byteLength >
        MAX_FILE_SIZE,
    );

    if (oversizedFile) {
      return `${oversizedFile.name} is larger than the 1 MB per-file export limit.`;
    }

    const normalizedPaths = exportFiles.map((file) => file.name);
    if (
      new Set(normalizedPaths).size !== normalizedPaths.length
    ) {
      return 'Each exported file must have a unique path.';
    }

    return null;
  };

  const validateMailto = (
    exportFiles: FileItem[],
  ): string | null => {
    if (exportFiles.length === 0) {
      return 'Select at least one project file to share.';
    }

    const rawBytes = new TextEncoder().encode(projectBundle).byteLength;
    if (rawBytes > MAX_MAILTO_BODY_BYTES) {
      return 'The selected source is too large for a mailto message. Use ZIP export instead.';
    }

    const encodedBody = encodeURIComponent(
      `Valton X project source\n\n${projectBundle}`,
    );
    if (encodedBody.length > MAX_MAILTO_URL_CHARS) {
      return 'The email link is too large for your email app. Use ZIP export instead.';
    }

    return null;
  };

  const handleExport = async (): Promise<void> => {
    if (!activeFile && normalizedFiles.length === 0) {
      setError('There is nothing to export.');
      return;
    }

    setIsExporting(true);
    setError(null);

    try {
      if (format === 'file') {
        if (!activeFile) {
          setError('There is no active file to export.');
          return;
        }

        downloadBlob(
          normalizeDownloadName(activeFile.name),
          activeFile.content,
          getMimeType(activeFile.name),
        );

        onClose();
        return;
      }

      if (format === 'email') {
        const mailtoError = validateMailto(selectedFiles);
        if (mailtoError) {
          setError(mailtoError);
          return;
        }

        await openMailComposer(email, activeFile, projectBundle);
        onClose();
        return;
      }

      const validationError = validateProject(selectedFiles);

      if (validationError) {
        setError(validationError);
        return;
      }

      downloadProjectZip();

      onClose();
    } catch (exportError: unknown) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'The project could not be exported.',
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackdropMouseDown = (
    event: MouseEvent<HTMLDivElement>,
  ): void => {
    if (
      event.target === event.currentTarget &&
      !isExporting
    ) {
      onClose();
    }
  };

  const isExportDisabled =
    isExporting ||
    (format === 'file' && !activeFile) ||
    (format !== 'file' && selectedFiles.length === 0);

  const downloadProjectZip = (): void => {
    const manifest: VlntoxManifest = {
      format: 'vlntox-project',
      version: 1,
      createdAt: new Date().toISOString(),
      entrypoints: webEntryPoint ? { web: webEntryPoint } : {},
      files: selectedFiles.map((file) => ({
        path: file.name,
        language: file.language,
        isWebProjectFile:
          file.isWebProjectFile === true ||
          file.language === 'html' ||
          file.language === 'css' ||
          file.language === 'javascript',
      })),
    };
    const archive = createZipArchive([
      {
        path: 'vlntox.json',
        content: JSON.stringify(manifest, null, 2),
      },
      ...selectedFiles.map((file) => ({
        path: file.name,
        content: file.content,
      })),
    ]);

    downloadBlob(
      'vlntox-project.zip',
      toBlobArrayBuffer(archive),
      'application/zip',
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={handleBackdropMouseDown}
    >
      <section
        aria-labelledby="export-modal-title"
        aria-modal="true"
        className="modal-panel w-full max-w-lg rounded-xl border p-6 shadow-2xl"
        role="dialog"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-lg font-bold text-primary"
              id="export-modal-title"
            >
               Export Valton X Project
            </h2>

            <p className="mt-1 text-xs text-secondary">
              Export locally from your browser. No paid service
              is required.
            </p>
          </div>

          <button
            aria-label="Close export dialog"
            className="icon-action rounded p-1"
            disabled={isExporting}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div
          aria-label="Export format"
          className="space-y-3"
          role="radiogroup"
        >
          <ExportOption
            checked={format === 'file'}
            description={
              activeFile
                ? `Save ${activeFile.name} to your device.`
                : 'No active file is available.'
            }
            disabled={!activeFile}
            icon={<Download size={15} />}
            onSelect={() => setFormat('file')}
            title="Download active file"
          />

          <ExportOption
            checked={format === 'project'}
            description={`Download selected project files as a ZIP archive with a Valton X manifest.`}
            disabled={normalizedFiles.length === 0}
            icon={<FileArchive size={15} />}
            onSelect={() => setFormat('project')}
            title="Export selected files as ZIP"
          />

          <ExportOption
            checked={format === 'email'}
            description="Open your email app with the selected project source copied into a new message."
            disabled={normalizedFiles.length === 0}
            icon={<Mail size={15} />}
            onSelect={() => setFormat('email')}
            title="Email selected files"
          />
        </div>

        {format !== 'file' ? (
          <div className="mt-4 rounded-lg border border-theme bg-surface-raised p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-primary">
                Choose files ({selectedFiles.length}/{normalizedFiles.length})
              </p>
              <div className="flex gap-2">
                <button
                  className="text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                  onClick={() =>
                    setSelectedFileIds(
                      normalizedFiles.map((file) => file.id),
                    )
                  }
                  type="button"
                >
                  Select all
                </button>
                <button
                  className="text-[11px] font-semibold text-secondary hover:text-primary"
                  onClick={() => setSelectedFileIds([])}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {normalizedFiles.map((file) => (
                <label
                  className="flex cursor-pointer items-center gap-2 text-xs text-secondary"
                  key={file.id}
                >
                  <input
                    checked={selectedFileIds.includes(file.id)}
                    onChange={(event) =>
                      setSelectedFileIds((currentIds) =>
                        event.target.checked
                          ? [...currentIds, file.id]
                          : currentIds.filter(
                              (id) => id !== file.id,
                            ),
                      )
                    }
                    type="checkbox"
                  />
                  <span className="truncate">{file.name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {format === 'project' ? (
          <p className="mt-3 text-[11px] text-muted">
            Selected archive size: {formatBytes(projectSize)}. Maximum
            project size: 10 MB.
          </p>
        ) : null}

        {format === 'email' ? (
          <div className="mt-3">
            <p className="mb-2 text-[11px] text-secondary">
              Your default email app will open with the selected source in
              the message body. No sign-in or Valton X email service is used.
            </p>
            <label className="mb-1 block text-xs font-semibold text-secondary">
              Recipient email (optional)
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="input-field w-full rounded-lg border px-3 py-2 text-xs outline-none"
            />
          </div>
        ) : null}

        {error ? (
          <p
            className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="secondary-action rounded px-4 py-2 text-xs font-semibold"
            disabled={isExporting}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>

          <button
            className="primary-action flex items-center gap-2 rounded px-4 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isExportDisabled}
            onClick={() => void handleExport()}
            type="button"
          >
            {format === 'email' ? (
              <Mail aria-hidden="true" size={14} />
            ) : format === 'project' ? (
              <FileArchive
                aria-hidden="true"
                size={14}
              />
            ) : (
              <Download aria-hidden="true" size={14} />
            )}

            {isExporting
              ? 'Preparing...'
              : getActionLabel(format)}
          </button>
        </div>
      </section>
    </div>
  );
};

const getActionLabel = (
  format: ExportFormat,
): string => {
  switch (format) {
    case 'file':
      return 'Download file';
    case 'project':
      return 'Download ZIP';
    case 'email':
      return 'Send via email';
  }
};

const openMailComposer = async (
  recipient: string,
  activeFile: FileItem | undefined,
  projectBundle: string,
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(projectBundle);
  } catch {
    // The mailto body remains available when clipboard permission is denied.
  }

  const subject = encodeURIComponent(
    `Valton X project export: ${activeFile?.name ?? 'source code'}`,
  );
  const body = encodeURIComponent(
    `Valton X project source\n\n${projectBundle}`,
  );
  const destination = recipient.trim()
    ? encodeURIComponent(recipient.trim())
    : '';

  window.location.href =
    `mailto:${destination}?subject=${subject}&body=${body}`;
};

const normalizeArchivePath = (value: string): string => {
  const parts: string[] = [];

  const normalizedValue = value.replaceAll('\\', '/');
  if (
    normalizedValue.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalizedValue)
  ) {
    return '';
  }

  for (const part of normalizedValue.split('/')) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      if (parts.length === 0) {
        return '';
      }
      parts.pop();
      continue;
    }

    if ([...part].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })) {
      return '';
    }

    parts.push(part);
  }

  return parts.join('/');
};

const normalizeDownloadName = (value: string): string => {
  const normalized = normalizeArchivePath(value);
  const parts = normalized.split('/');

    return (
      parts[parts.length - 1] ||
      'vlntox-file.txt'
    );
};

const getMimeType = (filename: string): string => {
  const extension = filename
    .split('.')
    .pop()
    ?.toLowerCase();

  switch (extension) {
    case 'html':
    case 'htm':
      return 'text/html;charset=utf-8';
    case 'css':
      return 'text/css;charset=utf-8';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
      return 'text/javascript;charset=utf-8';
    case 'json':
      return 'application/json;charset=utf-8';
    default:
      return 'text/plain;charset=utf-8';
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const createZipArchive = (
  entries: ZipEntry[],
): Uint8Array => {
  const encoder = new TextEncoder();
  const preparedEntries: PreparedZipEntry[] = [];
  const localParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const safePath = normalizeArchivePath(entry.path);

    if (!safePath) {
      continue;
    }

    const pathBytes = encoder.encode(safePath);
    const contentBytes = encoder.encode(entry.content);
    const checksum = crc32(contentBytes);
    const localHeader = createLocalFileHeader(
      pathBytes,
      contentBytes,
      checksum,
    );

    localParts.push(
      localHeader,
      pathBytes,
      contentBytes,
    );

    preparedEntries.push({
      pathBytes,
      contentBytes,
      checksum,
      offset: localOffset,
    });

    localOffset +=
      localHeader.length +
      pathBytes.length +
      contentBytes.length;
  }

  const centralParts: Uint8Array[] = [];
  let centralDirectorySize = 0;

  for (const entry of preparedEntries) {
    const centralHeader = createCentralDirectoryHeader(
      entry.pathBytes,
      entry.contentBytes,
      entry.checksum,
      entry.offset,
    );

    centralParts.push(centralHeader, entry.pathBytes);
    centralDirectorySize +=
      centralHeader.length + entry.pathBytes.length;
  }

  const endRecord = createEndOfCentralDirectory(
    preparedEntries.length,
    centralDirectorySize,
    localOffset,
  );

  return concatenateUint8Arrays([
    ...localParts,
    ...centralParts,
    endRecord,
  ]);
};

const createLocalFileHeader = (
  pathBytes: Uint8Array,
  contentBytes: Uint8Array,
  checksum: number,
): Uint8Array => {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime(), true);
  view.setUint16(12, dosDate(), true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, contentBytes.length, true);
  view.setUint32(22, contentBytes.length, true);
  view.setUint16(26, pathBytes.length, true);
  view.setUint16(28, 0, true);

  return header;
};

const createCentralDirectoryHeader = (
  pathBytes: Uint8Array,
  contentBytes: Uint8Array,
  checksum: number,
  offset: number,
): Uint8Array => {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);

  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime(), true);
  view.setUint16(14, dosDate(), true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, contentBytes.length, true);
  view.setUint32(24, contentBytes.length, true);
  view.setUint16(28, pathBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);

  return header;
};

const createEndOfCentralDirectory = (
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Uint8Array => {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);

  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);

  return record;
};

const concatenateUint8Arrays = (
  parts: Uint8Array[],
): Uint8Array => {
  const totalLength = parts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
};

const crc32 = (bytes: Uint8Array): number => {
  let checksum = 0xffffffff;

  for (const byte of bytes) {
    checksum ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      checksum =
        (checksum >>> 1) ^
        (checksum & 1 ? 0xedb88320 : 0);
    }
  }

  return (checksum ^ 0xffffffff) >>> 0;
};

const dosTime = (): number => {
  const now = new Date();

  return (
    (now.getHours() << 11) |
    (now.getMinutes() << 5) |
    Math.floor(now.getSeconds() / 2)
  );
};

const dosDate = (): number => {
  const now = new Date();
  const year = Math.max(now.getFullYear(), 1980);

  return (
    ((year - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate()
  );
};

const toBlobArrayBuffer = (
  bytes: Uint8Array,
): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

export default ExportModal;