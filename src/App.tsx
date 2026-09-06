import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from 'react-resizable-panels';
import type * as monaco from 'monaco-editor';
import {
  Files,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

import { CodeEditor } from './components/CodeEditor';
import { ConsolePreviewPanel } from './components/ConsolePreviewPanel';
import {
  FileExplorer,
  type ProjectFile,
} from './components/FileExplorer';
import { HeaderControls } from './components/HeaderControls';
import { ExportModal } from './components/ExportModal';
import { FeedbackModal } from './components/FeedbackModal';

import {
  WelcomeModal,
  shouldShowWelcome,
} from './components/WelcomeModal';

import { ExecutionClient } from './compiler/execution-client';
import type {
  ExecutionStatus,
  SupportedLanguage as RuntimeLanguage,
} from './compiler/execution-protocol';

import {
  clearMonacoMarkers,
  goToLineColumn,
  parseAndApplyDiagnostics,
} from './utils/monacoDiagnostics';

import {
  buildWebPreview,
  isWebProjectFile,
} from './utils/webPreview';

import {
  getLanguageFromFilename,
  isPreviewLanguage,
} from './utils/fileUtils';

import type {
  EditorTheme,
  FileItem,
  SupportedLanguage,
  TerminalPosition,
} from './types/byteplay';

type ForgeProjectFile = FileItem;

const INITIAL_FILES: ForgeProjectFile[] = [
  {
    id: 'main-c',
    name: 'main.c',
    language: 'c',
    content: `#include <stdio.h>

int main(void) {
    printf("Hello from Valton X C!\\n");
    return 0;
}
`,
  },
  {
    id: 'main-cpp',
    name: 'main.cpp',
    language: 'cpp',
    content: `#include <iostream>

int main() {
    std::cout << "Hello from Valton X C++!" << std::endl;
    return 0;
}
`,
  },
  {
    id: 'main-py',
    name: 'main.py',
    language: 'python',
    content: `print("Hello from Valton X Python!")

for index in range(5):
    print(index)
`,
  },
  {
    id: 'index-html',
    name: 'index.html',
    language: 'html',
    isWebProjectFile: true,
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
   <title>Valton X — Browser Coding Workspace</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main class="card">
    <h1>Hello from Valton X!</h1>
    <p>Edit index.html, style.css, and script.js together.</p>
    <button id="demo-button" type="button">Click me</button>
    <p id="message"></p>
  </main>

  <script src="./script.js"></script>
</body>
</html>
`,
  },
  {
    id: 'style-css',
    name: 'style.css',
    language: 'css',
    isWebProjectFile: true,
    content: `:root {
  color-scheme: dark;
  font-family: Inter, system-ui, sans-serif;
  background: #0f172a;
  color: #f8fafc;
}

body {
  min-height: 100vh;
  display: grid;
  place-items: center;
  margin: 0;
  background: linear-gradient(135deg, #0f172a, #1e1b4b);
}

.card {
  width: min(90vw, 520px);
  padding: 2rem;
  border: 1px solid #475569;
  border-radius: 1rem;
  background: rgb(15 23 42 / 85%);
  text-align: center;
  box-shadow: 0 20px 60px rgb(0 0 0 / 35%);
}

button {
  border: 0;
  border-radius: 0.5rem;
  padding: 0.65rem 1rem;
  background: #2563eb;
  color: white;
  cursor: pointer;
}
`,
  },
  {
    id: 'script-js',
    name: 'script.js',
    language: 'javascript',
    isWebProjectFile: true,
    content: `const button = document.querySelector('#demo-button');
const message = document.querySelector('#message');

button?.addEventListener('click', () => {
  message.textContent = 'JavaScript is connected successfully.';
});
`,
  },
];

const INITIAL_TERMINAL_LOGS = [
  'Valton X ready. Open a file and click Run Code.',
  'Tip: C and Python input is typed directly into this terminal.',
];

const THEME_STORAGE_KEY = 'forgebytex-theme';
const FILES_STORAGE_KEY = 'valton-x-files';
const ACTIVE_FILE_STORAGE_KEY = 'valton-x-active-file';

const createFileId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const isEditorTheme = (
  value: string | null,
): value is EditorTheme =>
  value === 'black' ||
  value === 'white' ||
  value === 'cyberpunk';

const getInitialTheme = (): EditorTheme => {
  if (typeof window === 'undefined') {
    return 'black';
  }

  const savedTheme = window.localStorage.getItem(
    THEME_STORAGE_KEY,
  );

  return isEditorTheme(savedTheme) ? savedTheme : 'black';
};

const isStoredProjectFile = (
  value: unknown,
): value is ForgeProjectFile => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const file = value as Partial<ForgeProjectFile>;

  return (
    typeof file.id === 'string' &&
    typeof file.name === 'string' &&
    typeof file.language === 'string' &&
    typeof file.content === 'string'
  );
};

const getInitialFiles = (): ForgeProjectFile[] => {
  if (typeof window === 'undefined') {
    return INITIAL_FILES;
  }

  try {
    const storedFiles = window.localStorage.getItem(
      FILES_STORAGE_KEY,
    );

    if (!storedFiles) {
      return INITIAL_FILES;
    }

    const parsedFiles: unknown = JSON.parse(storedFiles);

    if (
      Array.isArray(parsedFiles) &&
      parsedFiles.length > 0 &&
      parsedFiles.every(isStoredProjectFile)
    ) {
      return parsedFiles;
    }
  } catch {
    // Invalid saved workspace data falls back to the starter files.
  }

  return INITIAL_FILES;
};

const getInitialActiveFileId = (
  initialFiles: ForgeProjectFile[],
): string => {
  if (typeof window !== 'undefined') {
    const storedActiveFileId = window.localStorage.getItem(
      ACTIVE_FILE_STORAGE_KEY,
    );

    if (
      storedActiveFileId &&
      initialFiles.some(
        (file) => file.id === storedActiveFileId,
      )
    ) {
      return storedActiveFileId;
    }
  }

  return initialFiles[0]?.id ?? '';
};

const getInitialWorkspace = (): {
  files: ForgeProjectFile[];
  activeFileId: string;
} => {
  const files = getInitialFiles();

  return {
    files,
    activeFileId: getInitialActiveFileId(files),
  };
};

const INITIAL_WORKSPACE = getInitialWorkspace();

const getExtensionForLanguage = (
  language: SupportedLanguage,
): string => {
  switch (language) {
    case 'c':
      return 'c';
    case 'cpp':
      return 'cpp';
    case 'python':
      return 'py';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'javascript':
      return 'js';
    case 'sql':
      return 'sql';
    default:
      return 'txt';
  }
};

const toRuntimeLanguage = (
  language: SupportedLanguage,
): RuntimeLanguage => language;

export const App = (): ReactElement => {
  const [files, setFiles] =
    useState<ForgeProjectFile[]>(INITIAL_WORKSPACE.files);
  const [activeFileId, setActiveFileId] =
    useState(INITIAL_WORKSPACE.activeFileId);

  const [activeTheme] = useState<EditorTheme>(getInitialTheme);

  const [terminalPosition, setTerminalPosition] =
    useState<TerminalPosition>('bottom');

  const [terminalLogs, setTerminalLogs] = useState<string[]>(
    INITIAL_TERMINAL_LOGS,
  );

  const [clearGeneration, setClearGeneration] = useState(0);
  const [executionStatus, setExecutionStatus] =
    useState<ExecutionStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);

  const [errorOutput, setErrorOutput] = useState('');

  const [htmlPreviewDoc, setHtmlPreviewDoc] = useState<
    string | null
  >(null);

  const [isFocusMode] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] =
    useState(shouldShowWelcome);
  const [isFeedbackOpen, setIsFeedbackOpen] =
    useState(false);
  const [isExportOpen, setIsExportOpen] =
    useState(false);
  const [isExplorerOpen, setIsExplorerOpen] =
    useState(true);
  const [programInputs, setProgramInputs] = useState<
    Array<{ id: string; value: string }>
  >([]);
  
  const executionClientRef =
    useRef<ExecutionClient | null>(null);

  const monacoRef =
    useRef<typeof monaco | null>(null);

  const editorRef =
    useRef<monaco.editor.IStandaloneCodeEditor | null>(
      null,
    );

  const executionGenerationRef = useRef(0);

  const activeFile =
    files.find((file) => file.id === activeFileId) ??
    files[0];

  useEffect(() => {
    executionClientRef.current = new ExecutionClient();

    const handlePageHide = (): void => {
      executionClientRef.current?.terminate();
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener(
        'pagehide',
        handlePageHide,
      );
      executionClientRef.current?.terminate();
      executionClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    window.localStorage.setItem(
      THEME_STORAGE_KEY,
      activeTheme,
    );
  }, [activeTheme]);

  useEffect(() => {
    window.localStorage.setItem(
      FILES_STORAGE_KEY,
      JSON.stringify(files),
    );
    window.localStorage.setItem(
      ACTIVE_FILE_STORAGE_KEY,
      activeFileId,
    );
  }, [activeFileId, files]);

  const clearDiagnostics = useCallback((): void => {
    if (monacoRef.current && editorRef.current) {
      clearMonacoMarkers(
        monacoRef.current,
        editorRef.current,
      );
    }
  }, []);

  const appendTerminalLog = useCallback(
    (text: string): void => {
      if (!text) {
        return;
      }

      setTerminalLogs((currentLogs) => [
        ...currentLogs,
        text,
      ]);
    },
    [],
  );

  const handleSelectFile = useCallback(
    (fileId: string): void => {
      const selectedFile = files.find(
        (file) => file.id === fileId,
      );

      if (!selectedFile) {
        return;
      }

      setActiveFileId(fileId);
      setHtmlPreviewDoc(null);
      setErrorOutput('');
      // Clear prepared inputs when switching files to prevent stale stdin.
      setProgramInputs([]);
      clearDiagnostics();
    },
    [clearDiagnostics, files],
  );

  const handleUpdateCode = useCallback(
    (content: string): void => {
      setFiles((currentFiles) =>
        currentFiles.map((file) =>
          file.id === activeFileId
            ? { ...file, content }
            : file,
        ),
      );

      clearDiagnostics();
      setErrorOutput('');

      if (activeFile && isWebProjectFile(activeFile)) {
        setHtmlPreviewDoc(null);
      }
    },
    [activeFile, activeFileId, clearDiagnostics],
  );

  const handleAddFile = useCallback(
    (requestedName = ''): void => {
    const trimmedName = requestedName.trim();
    const fileName =
      trimmedName || `script-${files.length + 1}.js`;
    const language = getLanguageFromFilename(fileName);
    const extension = getExtensionForLanguage(language);
    const normalizedFileName = trimmedName
      ? fileName
      : `script-${files.length + 1}.${extension}`;

    const newFile: ForgeProjectFile = {
      id: createFileId(),
      name: normalizedFileName,
      language,
      isWebProjectFile: isWebProjectFile({ language }),
      content: '',
    };

    setFiles((currentFiles) => [
      ...currentFiles,
      newFile,
    ]);
    setActiveFileId(newFile.id);
    setHtmlPreviewDoc(null);
    setErrorOutput('');
    clearDiagnostics();
    },
    [clearDiagnostics, files.length],
  );

  const handleRenameFile = useCallback(
    (fileId: string, newName: string): void => {
      const trimmedName = newName.trim();

      if (!trimmedName) {
        return;
      }

      setFiles((currentFiles) =>
        currentFiles.map((file) =>
          file.id === fileId
            ? {
                ...file,
                name: trimmedName,
                language:
                  getLanguageFromFilename(trimmedName),
                isWebProjectFile:
                  isWebProjectFile({
                    language:
                      getLanguageFromFilename(trimmedName),
                  }),
              }
            : file,
        ),
      );

      setHtmlPreviewDoc(null);
      setErrorOutput('');
    },
    [],
  );

  const handleDeleteFile = useCallback(
    (fileId: string): void => {
      if (files.length <= 1) {
        return;
      }

      const remainingFiles = files.filter(
        (file) => file.id !== fileId,
      );

      setFiles(remainingFiles);

      if (fileId === activeFileId) {
        const nextFile = remainingFiles[0];

        setActiveFileId(nextFile.id);
      }

      setHtmlPreviewDoc(null);
      setErrorOutput('');
      clearDiagnostics();
    },
    [
      activeFileId,
      clearDiagnostics,
      files,
    ],
  );

  const handleSendInput = useCallback(
    (input: string): void => {
      const sent =
        executionClientRef.current?.sendInput(input) ??
        false;

      if (!sent) {
        appendTerminalLog(
          '[Valton X] No program is currently waiting for input.',
        );
      }
    },
    [appendTerminalLog],
  );

  const handleRun = useCallback(async (): Promise<void> => {
    const executionClient = executionClientRef.current;

    if (!activeFile || !executionClient) {
      return;
    }

    if (isRunning) {
      executionGenerationRef.current += 1;
      executionClient.stop();
      setIsRunning(false);
      setExecutionStatus('stopped');
      setErrorOutput('');
      appendTerminalLog(
        '[Valton X] Execution stopped by the user.',
      );
      return;
    }

    clearDiagnostics();
    setErrorOutput('');

    const generation = ++executionGenerationRef.current;
    const isCurrentExecution = (): boolean =>
      executionGenerationRef.current === generation;

    if (isPreviewLanguage(activeFile.language)) {
      const preview = buildWebPreview(files);

      setHtmlPreviewDoc(preview.document || null);
      setExecutionStatus(
        preview.diagnostics.some(
          (diagnostic) => diagnostic.severity === 'error',
        )
          ? 'failed'
          : 'completed',
      );

      setTerminalLogs((currentLogs) => [
        ...currentLogs,
        `Rendered ${preview.entryFileName || 'web project'} preview.`,
      ]);

      return;
    }

    setIsRunning(true);
    setExecutionStatus('preparing');

    appendTerminalLog(
      `> Starting ${activeFile.name}...`,
    );

    // Build the upfront stdin string from the prepared input items.
    // This is NOT live interactive stdin – inputs are prepared before Run is pressed.
    let stdinString = programInputs
      .map((item) => item.value)
      .join('\n');

    const readsStandardInput =
      activeFile.language === 'c' ||
      activeFile.language === 'cpp'
        ? /\b(scanf|fgets|getchar|getc|cin)\b/.test(
            activeFile.content,
          )
        : false;

    if (
      readsStandardInput &&
      programInputs.length === 0
    ) {
      const promptedInput = window.prompt(
        'Enter program input. Use spaces or new lines between values:',
        '',
      );

      if (promptedInput === null) {
        setIsRunning(false);
        setExecutionStatus('stopped');
        appendTerminalLog(
          '[Valton X] Execution cancelled before input was provided.',
        );
        return;
      }

      stdinString = promptedInput;
      appendTerminalLog(
        '[Valton X] Using the input provided before execution.',
      );
    }

    if (
      (activeFile.language === 'c' ||
        activeFile.language === 'cpp') &&
      programInputs.length > 0
    ) {
      appendTerminalLog(
        `[Valton X] Running with ${programInputs.length} prepared stdin line${programInputs.length === 1 ? '' : 's'}.`,
      );
    }

    try {
      const result = await executionClient.execute(
        {
          fileName: activeFile.name,
          code: activeFile.content,
          language: toRuntimeLanguage(
            activeFile.language,
          ),
          stdin: stdinString,
        },
        {
          onOutput: (_stream, text, attempt) => {
            if (!isCurrentExecution() || !text) {
              return;
            }

            appendTerminalLog(
              attempt > 1
                ? `[input retry ${attempt}] ${text}`
                : text,
            );
          },
          onStatus: (status) => {
            if (isCurrentExecution()) {
              setExecutionStatus(status);
            }
          },
        },
      );

      if (!isCurrentExecution()) {
        return;
      }

      setExecutionStatus(result.status);
      setIsRunning(false);

      if (!result.success) {
        const diagnosticText =
          result.error ||
          result.output ||
          'Unknown execution error.';

        setErrorOutput(diagnosticText);

        if (monacoRef.current && editorRef.current) {
          parseAndApplyDiagnostics(
            monacoRef.current,
            editorRef.current,
            diagnosticText,
            activeFile.language,
          );
        }
      } else if (result.warnings) {
        appendTerminalLog(result.warnings);
      }
    } catch (error: unknown) {
      if (!isCurrentExecution()) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : 'Execution failed unexpectedly.';

      setExecutionStatus('failed');
      setIsRunning(false);
      setErrorOutput(message);
    }
  }, [
    activeFile,
    appendTerminalLog,
    clearDiagnostics,
    files,
    isRunning,
    programInputs,
  ]);

  const handleClearTerminal = useCallback((): void => {
    setTerminalLogs([]);
    setClearGeneration((generation) => generation + 1);
    setHtmlPreviewDoc(null);
    setErrorOutput('');
    setExecutionStatus('idle');
  }, []);

  const handleReset = useCallback((): void => {
    executionGenerationRef.current += 1;
    executionClientRef.current?.stop();

    setFiles(INITIAL_FILES);
    setActiveFileId(INITIAL_FILES[0].id);
    setTerminalLogs(INITIAL_TERMINAL_LOGS);
    setClearGeneration((generation) => generation + 1);
    setHtmlPreviewDoc(null);
    setErrorOutput('');
    setExecutionStatus('idle');
    setIsRunning(false);
    setProgramInputs([]);

    clearDiagnostics();
  }, [clearDiagnostics]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'F5') {
        event.preventDefault();
        void handleRun();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [handleRun]);

  const editorFiles: ProjectFile[] = files.map((file) => ({
    id: file.id,
    name: file.name,
    language: file.language,
    content: file.content,
  }));

  const renderEditor = (): ReactElement => (
    <div className="flex h-full w-full flex-col overflow-hidden bg-editor-bg">
      <div className="relative min-h-0 flex-1">
        <CodeEditor
          activeFileId={activeFile?.id}
          code={activeFile?.content ?? ''}
          files={editorFiles}
          language={
            activeFile?.language ?? 'plaintext'
          }
          onChange={handleUpdateCode}
          onMount={(editor, monacoInstance) => {
            editorRef.current = editor;
            monacoRef.current = monacoInstance;
          }}
          onSelectFile={handleSelectFile}
          theme={activeTheme}
        />
      </div>
    </div>
  );

  const renderConsole = (): ReactElement => {
    const lang = activeFile?.language ?? 'plaintext';
    

    return (
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConsolePreviewPanel
            activeLanguage={lang}
            activeTheme={activeTheme}
            clearGeneration={clearGeneration}
            errorFileName={activeFile?.name}
            errorOutput={errorOutput}
            executionStatus={executionStatus}
            files={files}
            htmlPreviewDoc={htmlPreviewDoc}
            isWaitingForInput={
              executionStatus === 'waiting-input'
            }
            onClearError={() => setErrorOutput('')}
            onClearTerminal={handleClearTerminal}
            onJumpToError={(line, column) => {
              goToLineColumn(editorRef.current, line, column);
            }}
            onSendInput={handleSendInput}
            onTerminalPositionChange={setTerminalPosition}
            terminalLogs={terminalLogs}
            terminalPosition={terminalPosition}
          />
        </div>

      </div>
    );
  };

  return (
    <div className="app-shell flex h-screen w-screen flex-col overflow-hidden font-sans">
      <HeaderControls
        isRunning={isRunning}
        onClear={handleClearTerminal}
        onExport={() => setIsExportOpen(true)}
        onFeedbackClick={() => setIsFeedbackOpen(true)}
        onReset={handleReset}
        onRun={() => void handleRun()}
      />

      <main className="app-main relative min-h-0 flex-1 overflow-hidden">
        {isFocusMode ? (
          <PanelGroup
            className="h-full w-full"
            orientation="vertical"
          >
            <Panel defaultSize="60" minSize="30">
              {renderEditor()}
            </Panel>

            <PanelResizeHandle className="workspace-resizer h-1 cursor-row-resize" />

            <Panel defaultSize="40" minSize="20">
              {renderConsole()}
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex h-full w-full">
            <aside
              aria-label="Workspace activity"
              className="activity-sidebar flex w-12 shrink-0 flex-col items-center gap-2 border-r border-theme bg-surface py-2"
            >
              <button
                aria-label={
                  isExplorerOpen
                    ? 'Collapse file explorer'
                    : 'Open file explorer'
                }
                className="icon-action rounded-md p-2"
                onClick={() => setIsExplorerOpen((current) => !current)}
                title={
                  isExplorerOpen
                    ? 'Collapse file explorer'
                    : 'Open file explorer'
                }
                type="button"
              >
                {isExplorerOpen ? (
                  <PanelLeftClose aria-hidden="true" size={16} />
                ) : (
                  <PanelLeftOpen aria-hidden="true" size={16} />
                )}
              </button>

              <Files
                aria-hidden="true"
                className="mt-auto text-muted"
                size={15}
              />
            </aside>

            <PanelGroup
              className="h-full min-w-0 flex-1"
              orientation="horizontal"
            >
              {isExplorerOpen ? (
                <Panel
                  defaultSize="20"
                  maxSize="35"
                  minSize="15"
                >
                  <FileExplorer
                    activeFileId={activeFile?.id ?? ''}
                    files={editorFiles}
                    onAddFile={handleAddFile}
                    onDeleteFile={handleDeleteFile}
                    onRenameFile={handleRenameFile}
                    onSelectFile={handleSelectFile}
                  />
                </Panel>
              ) : null}

              {isExplorerOpen ? (
                <PanelResizeHandle className="workspace-resizer w-1 cursor-col-resize" />
              ) : null}

              <Panel defaultSize="80">
                <PanelGroup
                  className="h-full w-full"
                  orientation={
                    terminalPosition === 'right'
                      ? 'horizontal'
                      : 'vertical'
                  }
                >
                  <Panel defaultSize="60" minSize="30">
                    {renderEditor()}
                  </Panel>

                  <PanelResizeHandle
                    className={
                      terminalPosition === 'right'
                        ? 'workspace-resizer w-1 cursor-col-resize'
                        : 'workspace-resizer h-1 cursor-row-resize'
                    }
                  />

                  <Panel defaultSize="40" minSize="20">
                    {renderConsole()}
                  </Panel>
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </div>
        )}
      </main>

      <WelcomeModal
        isOpen={isWelcomeOpen}
        onClose={() => setIsWelcomeOpen(false)}
      />

      <FeedbackModal
        currentLanguage={activeFile?.language ?? 'plaintext'}
        currentTheme={activeTheme}
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
      />

      <ExportModal
        activeFile={activeFile}
        files={files}
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />
    </div>
  );
};

export default App;