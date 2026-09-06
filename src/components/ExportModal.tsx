import {
  Check,
  Download,
  FileArchive,
  Mail,
  X,
} from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  useEffect,
  useMemo,
  useState,
  type FC,
  type MouseEvent,
  type ReactNode,
} from 'react';

import type { FileItem } from '../types/byteplay';
import {
  firebaseAuth,
  getFirebaseIdToken,
} from '../lib/firebase';

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
  const [fallbackAvailable, setFallbackAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<User | null>(
    firebaseAuth?.currentUser ?? null,
  );
  const [turnstileToken, setTurnstileToken] = useState('');

  const turnstileSiteKey =
    import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

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

  const projectSize = useMemo(
    () =>
      normalizedFiles.reduce(
        (total, file) =>
          total +
          new TextEncoder().encode(file.content).byteLength,
        0,
      ),
    [normalizedFiles],
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
      normalizedFiles
        .map(
          (file) =>
            `===== ${file.name} =====\n\n${file.content}\n\n`,
        )
        .join(''),
    [normalizedFiles],
  );

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

  useEffect(() => {
    if (!firebaseAuth) {
      return undefined;
    }

    return onAuthStateChanged(firebaseAuth, setUser);
  }, []);

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

  const validateProject = (): string | null => {
    if (normalizedFiles.length === 0) {
      return 'There are no valid files to export.';
    }

    if (normalizedFiles.length > MAX_FILE_COUNT) {
      return `Projects may contain at most ${MAX_FILE_COUNT} files.`;
    }

    if (projectSize > MAX_PROJECT_SIZE) {
      return 'The project is larger than the 10 MB browser export limit.';
    }

    const oversizedFile = normalizedFiles.find(
      (file) =>
        new TextEncoder().encode(file.content).byteLength >
        MAX_FILE_SIZE,
    );

    if (oversizedFile) {
      return `${oversizedFile.name} is larger than the 1 MB per-file export limit.`;
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
    setFallbackAvailable(false);

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
        if (normalizedFiles.length === 0) {
          setError('There are no project files to share.');
          return;
        }

        if (!user) {
          setError('Sign in before sending an email export.');
          return;
        }

        if (!turnstileSiteKey || !turnstileToken) {
          setError('Complete the security check before sending.');
          return;
        }

        const idToken = await getFirebaseIdToken();

        if (!idToken) {
          setError('Your sign-in session expired. Please sign in again.');
          return;
        }

        const subject = `Valton X export: ${activeFile?.name ?? 'source code'}`;
        const payload = {
          email,
          filename: activeFile?.name ?? 'source.txt',
          content: projectBundle,
          subject,
        };

        const response = await fetch('/api/export-email', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...payload,
            turnstileToken,
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();
          let data: { error?: unknown; fallbackAllowed?: unknown } = {};

          try {
            data = JSON.parse(responseText) as typeof data;
          } catch {
            // Vercel may return an HTML/text error page for a failed function.
          }

          if (data?.fallbackAllowed) {
            setFallbackAvailable(true);
            setError(
              typeof data.error === 'string'
                ? data.error
                : `Email delivery failed (HTTP ${response.status}).`,
            );
            return;
          }

          const serverError =
            typeof data.error === 'string' ? data.error : responseText.trim();

          throw new Error(
            serverError ||
              `Email export failed with HTTP ${response.status}.`,
          );
        }

        onClose();
        return;
      }

      const validationError = validateProject();

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
    (format === 'email' &&
      (!user ||
        !turnstileSiteKey ||
        !turnstileToken ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
    (format !== 'file' && format !== 'email' && normalizedFiles.length === 0);

  const downloadProjectZip = (): void => {
    const manifest: VlntoxManifest = {
      format: 'vlntox-project',
      version: 1,
      createdAt: new Date().toISOString(),
      entrypoints: webEntryPoint ? { web: webEntryPoint } : {},
      files: normalizedFiles.map((file) => ({
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
      ...normalizedFiles.map((file) => ({
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

  const openMailFallback = (): void => {
    const subject = encodeURIComponent(
      `Valton X project export: ${activeFile?.name ?? 'source code'}`,
    );
    const body = encodeURIComponent(
      'I downloaded the Valton X project ZIP and attached it to this email.',
    );
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
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
            description={`Download ${normalizedFiles.length} project file${
              normalizedFiles.length === 1 ? '' : 's'
            } as a ZIP archive with a Valton X manifest.`}
            disabled={normalizedFiles.length === 0}
            icon={<FileArchive size={15} />}
            onSelect={() => setFormat('project')}
            title="Export complete project ZIP"
          />

          <ExportOption
            checked={format === 'email'}
            description="Send the project source to a recipient email via the Valton X export service."
            disabled={normalizedFiles.length === 0}
            icon={<Mail size={15} />}
            onSelect={() => setFormat('email')}
            title="Share through email"
          />
        </div>

        {format === 'project' ? (
          <p className="mt-3 text-[11px] text-muted">
            Archive size: {formatBytes(projectSize)}. Maximum
            project size: 10 MB.
          </p>
        ) : null}

        {fallbackAvailable ? (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-200">
              Email delivery is unavailable or today&apos;s export was already
              used. Download the ZIP and attach it manually.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="secondary-action rounded px-3 py-2 text-xs font-semibold"
                onClick={downloadProjectZip}
                type="button"
              >
                Download ZIP
              </button>
              <button
                className="secondary-action rounded px-3 py-2 text-xs font-semibold"
                onClick={openMailFallback}
                type="button"
              >
                Open mail app
              </button>
            </div>
          </div>
        ) : null}

        {format === 'email' ? (
          <div className="mt-3">
            <p className="mb-2 text-[11px] text-secondary">
              {user
                ? 'Your account is required to protect the export service.'
                : 'Sign in from the header before sending an email export.'}
            </p>
            <label className="block text-xs font-semibold text-secondary mb-1">
              Recipient email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="input-field w-full rounded-lg border px-3 py-2 text-xs outline-none"
            />
            {turnstileSiteKey ? (
              <div className="mt-3">
                <Turnstile
                  onError={() => {
                    setTurnstileToken('');
                    setError('Security check failed. Please try again.');
                  }}
                  onExpire={() => setTurnstileToken('')}
                  onSuccess={setTurnstileToken}
                  siteKey={turnstileSiteKey}
                />
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-amber-300">
                Turnstile is not configured for this environment.
              </p>
            )}
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

const normalizeArchivePath = (value: string): string => {
  const parts: string[] = [];

  for (const part of value.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      parts.pop();
      continue;
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