/**
 * Structured, beginner-friendly explanation returned by the diagnostic layer.
 *
 * The raw compiler/runtime message is always preserved so users can inspect
 * the original failure after reading the plain-language explanation.
 */
export interface HumorousErrorInsight {
  rawError: string;
  humorousTitle: string;
  friendlyExplanation: string;
  suggestedFix: string;
  lineNumber?: number;
  columnNumber?: number;
  emoji: string;
  category?:
    | 'syntax'
    | 'runtime'
    | 'name'
    | 'type'
    | 'memory'
    | 'unknown';
  diagnosticType?: DiagnosticType;
  confidence?: number;
}

export type DiagnosticType =
  | 'compile_error'
  | 'link_error'
  | 'runtime_error'
  | 'timeout'
  | 'aborted'
  | 'worker_crash'
  | 'input_closed'
  | 'output_limit'
  | 'package_load_error'
  | 'unsupported_feature'
  | 'internal_error'
  | 'unknown';

/**
 * Backward-compatible alias used by existing diagnostic components.
 */
export type ParsedErrorInsight = HumorousErrorInsight;

/**
 * Converts compiler and runtime diagnostics into useful editor-facing data.
 *
 * This parser is deliberately deterministic and local. It does not send
 * source code or error output to an external API.
 */
export class ErrorInterpreter {
  public static parse(
    rawError: string,
    language: string,
  ): HumorousErrorInsight {
    const normalizedError = rawError.trim();

    if (!normalizedError) {
      return this.createEmptyError();
    }

    const normalizedLanguage = language.trim().toLowerCase();

    const executionInsight = this.parseExecutionFailure(
      normalizedError,
    );
    if (executionInsight) {
      return executionInsight;
    }

    if (
      normalizedLanguage === 'python' ||
      normalizedLanguage === 'py'
    ) {
      return this.parsePythonError(normalizedError);
    }

    if (
      normalizedLanguage === 'c' ||
      normalizedLanguage === 'cpp' ||
      normalizedLanguage === 'c++'
    ) {
      return this.parseCError(normalizedError);
    }

    if (
      normalizedLanguage === 'javascript' ||
      normalizedLanguage === 'js'
    ) {
      return this.parseJavaScriptError(normalizedError);
    }

    return this.fallbackError(normalizedError);
  }

  /**
   * Parses common GCC/Clang diagnostics such as:
   *
   * main.c:8:5: error: expected ';' before 'return'
   */
  private static parseCError(
    rawError: string,
  ): HumorousErrorInsight {
    const location = this.extractLocation(rawError);
    const message = this.extractCompilerMessage(rawError);
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes("expected ';'") ||
      lowerMessage.includes('missing semicolon') ||
      lowerMessage.includes('expected expression')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Semicolon Has Left the Chat.',
        friendlyExplanation:
          'The compiler reached this statement before finding the punctuation or expression it expected.',
        suggestedFix:
          'Add a semicolon at the end of the incomplete statement and check the line immediately above it.',
        emoji: '🫠',
        category: 'syntax',
        confidence: 0.96,
      };
    }

    if (
      lowerMessage.includes('undeclared') ||
      lowerMessage.includes('not declared') ||
      lowerMessage.includes('use of undeclared identifier')
    ) {
      const variableName = this.extractQuotedName(message);

      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: "Who's That Variable?",
        friendlyExplanation:
          `The program uses "${variableName}", but that name has not been declared in the current scope.`,
        suggestedFix:
          `Declare "${variableName}" before using it, or check whether its spelling and scope are correct.`,
        emoji: '🕵️',
        category: 'name',
        confidence: 0.95,
      };
    }

    if (
      lowerMessage.includes('implicit declaration of function') ||
      lowerMessage.includes('no member named') ||
      lowerMessage.includes('undefined reference to')
    ) {
      const functionName = this.extractQuotedName(message);

      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'A Function Without Its Introduction.',
        friendlyExplanation:
          `The compiler cannot find a declaration or definition for "${functionName}".`,
        suggestedFix:
          'Include the correct header, check the function spelling, and make sure its implementation is linked into the program.',
        emoji: '🎒',
        category: 'name',
        confidence: 0.88,
      };
    }

    if (
      lowerMessage.includes('expected }') ||
      lowerMessage.includes("expected '}'") ||
      lowerMessage.includes('expected )') ||
      lowerMessage.includes("expected ')'")
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'Bracket Drama in Progress.',
        friendlyExplanation:
          'An opening brace or parenthesis does not have a matching closing symbol.',
        suggestedFix:
          'Count the opening and closing braces or parentheses around this section and close the unmatched block.',
        emoji: '🚪',
        category: 'syntax',
        confidence: 0.91,
      };
    }

    if (
      lowerMessage.includes('incompatible') ||
      lowerMessage.includes('invalid conversion') ||
      lowerMessage.includes('incompatible pointer')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'These Types Are Not Getting Along.',
        friendlyExplanation:
          'The program is assigning or passing a value to a type that cannot safely accept it.',
        suggestedFix:
          'Check the variable and function types. Use the correct type or an intentional, safe conversion.',
        emoji: '🧩',
        category: 'type',
        confidence: 0.87,
      };
    }

    if (
      lowerMessage.includes('segmentation fault') ||
      lowerMessage.includes('sigsegv') ||
      lowerMessage.includes('address boundary')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'Your Program Crossed a Memory Boundary.',
        friendlyExplanation:
          'The program accessed memory that does not belong to the requested array, pointer, or object.',
        suggestedFix:
          'Check pointer initialization, array bounds, allocated memory size, and whether freed memory is being reused.',
        emoji: '💀',
        category: 'memory',
        confidence: 0.94,
      };
    }

    if (
      lowerMessage.includes('division by zero') ||
      lowerMessage.includes('divide by zero')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Denominator Vanished.',
        friendlyExplanation:
          'The program attempted to divide a value by zero.',
        suggestedFix:
          'Check the denominator before division and handle the zero case explicitly.',
        emoji: '🕳️',
        category: 'runtime',
        confidence: 0.94,
      };
    }

    return this.fallbackError(
      rawError,
      location.line,
      location.column,
    );
  }

  /**
   * Parses Python tracebacks and common Pyodide exceptions.
   */
  private static parsePythonError(
    rawError: string,
  ): HumorousErrorInsight {
    const location = this.extractPythonLocation(rawError);
    const lowerError = rawError.toLowerCase();

    if (lowerError.includes('indentationerror')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'Python Is Very Particular About Its Spaces.',
        friendlyExplanation:
          'Python found inconsistent indentation or expected an indented block.',
        suggestedFix:
          'Indent the code inside the block and use one indentation style consistently. Four spaces is a safe convention.',
        emoji: '📐',
        category: 'syntax',
        confidence: 0.97,
      };
    }

    if (lowerError.includes('nameerror')) {
      const variableName =
        rawError.match(
          /name ['"]([^'"]+)['"] is not defined/i,
        )?.[1] ?? 'this name';

      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: "We're Looking for a Name Nobody Introduced.",
        friendlyExplanation:
          `Python cannot find a definition for "${variableName}" in the current scope.`,
        suggestedFix:
          `Check the spelling, define "${variableName}" before using it, or pass it into the current function.`,
        emoji: '🕵️',
        category: 'name',
        confidence: 0.96,
      };
    }

    if (lowerError.includes('zerodivisionerror')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Universe Almost Ended.',
        friendlyExplanation:
          'The program attempted to divide a number by zero.',
        suggestedFix:
          'Check the denominator before dividing and handle the zero case explicitly.',
        emoji: '🌌',
        category: 'runtime',
        confidence: 0.98,
      };
    }

    if (lowerError.includes('typeerror')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'These Two Values Do Not Fit Together.',
        friendlyExplanation:
          'The operation combines values whose Python types are incompatible.',
        suggestedFix:
          'Inspect the value types and convert them with int(), float(), str(), or another appropriate conversion.',
        emoji: '🧩',
        category: 'type',
        confidence: 0.93,
      };
    }

    if (lowerError.includes('indexerror')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'You Asked the List for a Room It Does Not Have.',
        friendlyExplanation:
          'The code requested a list or sequence index outside its valid range.',
        suggestedFix:
          'Check the sequence length and make sure the index is between zero and length minus one.',
        emoji: '📦',
        category: 'runtime',
        confidence: 0.97,
      };
    }

    if (lowerError.includes('keyerror')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'That Dictionary Key Went Missing.',
        friendlyExplanation:
          'The dictionary does not contain the key requested by the program.',
        suggestedFix:
          'Check the key spelling or use dict.get(key) when a missing key is expected.',
        emoji: '🔑',
        category: 'runtime',
        confidence: 0.97,
      };
    }

    if (
      lowerError.includes('importerror') ||
      lowerError.includes('modulenotfounderror')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'Python Could Not Find That Module.',
        friendlyExplanation:
          'The requested module is not available in the current browser runtime.',
        suggestedFix:
          'Check the import spelling and confirm that the package is supported by the local Pyodide environment.',
        emoji: '📦',
        category: 'runtime',
        confidence: 0.9,
      };
    }

    if (
      lowerError.includes('syntaxerror') ||
      lowerError.includes('invalid syntax')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'Python Is Scratching Its Head.',
        friendlyExplanation:
          'Python could not understand the structure of this statement.',
        suggestedFix:
          'Check colons, quotes, brackets, commas, and the indentation of the surrounding block.',
        emoji: '🤔',
        category: 'syntax',
        confidence: 0.9,
      };
    }

    return this.fallbackError(
      rawError,
      location.line,
      location.column,
    );
  }

  /**
   * Parses browser JavaScript errors shown by the preview runtime.
   */
  private static parseJavaScriptError(
    rawError: string,
  ): HumorousErrorInsight {
    const location = this.extractLocation(rawError);
    const lowerError = rawError.toLowerCase();

    if (lowerError.includes('maximum call stack')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Call Stack Reached the Sky.',
        friendlyExplanation:
          'A function kept calling itself or another function without reaching a stopping condition.',
        suggestedFix:
          'Check recursive functions and add a clear base case or termination condition.',
        emoji: '🥞',
        category: 'runtime',
        confidence: 0.97,
      };
    }

    if (lowerError.includes('is not defined')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'JavaScript Cannot Find That Name.',
        friendlyExplanation:
          'The code references a variable or function that does not exist in the current scope.',
        suggestedFix:
          'Check the spelling, declaration order, and whether the required script is included in the preview.',
        emoji: '🔎',
        category: 'name',
        confidence: 0.95,
      };
    }

    if (
      lowerError.includes('execution limit exceeded') ||
      lowerError.includes('script timed out')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'This Loop Refuses to Retire.',
        friendlyExplanation:
          'The preview runtime stopped the program because it exceeded the browser execution limit.',
        suggestedFix:
          'Check loop conditions and make sure every loop has a reachable stopping condition.',
        emoji: '🔄',
        category: 'runtime',
        confidence: 0.94,
      };
    }

    return this.fallbackError(
      rawError,
      location.line,
      location.column,
    );
  }

  /**
   * Extracts GCC/Clang-style filename, line, and column coordinates.
   */
  private static extractLocation(rawError: string): {
    line?: number;
    column?: number;
  } {
    const match = rawError.match(/:(\d+):(\d+)(?::|\s)/);

    return {
      line: match ? Number(match[1]) : undefined,
      column: match ? Number(match[2]) : undefined,
    };
  }

  /**
   * Extracts Python traceback coordinates.
   */
  private static extractPythonLocation(rawError: string): {
    line?: number;
    column?: number;
  } {
    const tracebackMatch = rawError.match(
      /File\s+["'][^"']+["'],\s+line\s+(\d+)/i,
    );

    if (tracebackMatch) {
      return {
        line: Number(tracebackMatch[1]),
      };
    }

    const syntaxMatch = rawError.match(
      /line\s+(\d+)/i,
    );

    return {
      line: syntaxMatch ? Number(syntaxMatch[1]) : undefined,
    };
  }

  /**
   * Extracts the meaningful message from a compiler diagnostic line.
   */
  private static extractCompilerMessage(
    rawError: string,
  ): string {
    const match = rawError.match(
      /(?:error|warning):\s*(.+)$/im,
    );

    return match?.[1]?.trim() ?? rawError;
  }

  /**
   * Extracts a quoted identifier from compiler output.
   */
  private static extractQuotedName(
    message: string,
  ): string {
    return (
      message.match(
        /['‘"`]([^'’"`]+)['’"`]/,
      )?.[1] ?? 'this symbol'
    );
  }

  /**
   * Provides a consistent result when no specialized pattern matches.
   */
  private static fallbackError(
    rawError: string,
    lineNumber?: number,
    columnNumber?: number,
  ): HumorousErrorInsight {
    return {
      rawError,
      lineNumber,
      columnNumber,
      humorousTitle: 'The Code Had a Hiccup.',
      friendlyExplanation:
        'Execution stopped because the runtime reported an error that needs closer inspection.',
      suggestedFix:
        'Read the raw message below, then check the highlighted line and the statements immediately before it.',
      emoji: '🛠️',
      category: 'unknown',
      diagnosticType: this.inferDiagnosticType(rawError),
      confidence: 0.45,
    };
  }

  /**
   * Handles empty diagnostics without producing a blank error panel.
   */
  private static createEmptyError(): HumorousErrorInsight {
    return {
      rawError: 'Unknown error',
      humorousTitle: 'Ghosts in the Machine.',
      friendlyExplanation:
        'The runtime failed without providing a readable diagnostic message.',
      suggestedFix:
        'Run the program again and check the surrounding code for an empty file or incomplete statement.',
      emoji: '👻',
      category: 'unknown',
      diagnosticType: 'unknown',
      confidence: 0.2,
    };
  }

  private static parseExecutionFailure(
    rawError: string,
  ): HumorousErrorInsight | null {
    const lowerError = rawError.toLowerCase();
    const location = this.extractLocation(rawError);

    if (
      lowerError.includes('output limit') ||
      lowerError.includes('output-limit')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Output Monitor Reached Its Safety Limit.',
        friendlyExplanation:
          'The program produced more output than the browser terminal safely keeps in memory.',
        suggestedFix:
          'Reduce repeated printing, print only the required data, or move this workload to an isolated backend.',
        emoji: '📟',
        category: 'runtime',
        diagnosticType: 'output_limit',
        confidence: 0.99,
      };
    }

    if (lowerError.includes('timed out') || lowerError.includes('timeout')) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Runtime Check-Up Timed Out.',
        friendlyExplanation:
          'The program did not finish within the browser execution window.',
        suggestedFix:
          'Check for infinite loops or reduce the workload before running it again.',
        emoji: '⏱️',
        category: 'runtime',
        diagnosticType: 'timeout',
        confidence: 0.99,
      };
    }

    if (
      lowerError.includes('execution stopped') ||
      lowerError.includes('aborted by the user')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Check-Up Was Stopped by the User.',
        friendlyExplanation:
          'Execution was intentionally interrupted before the program finished.',
        suggestedFix:
          'Run the program again when you are ready to continue.',
        emoji: '🛑',
        category: 'runtime',
        diagnosticType: 'aborted',
        confidence: 0.99,
      };
    }

    if (
      lowerError.includes('worker stopped unexpectedly') ||
      lowerError.includes('worker error')
    ) {
      return {
        rawError,
        lineNumber: location.line,
        columnNumber: location.column,
        humorousTitle: 'The Runtime Worker Needs Attention.',
        friendlyExplanation:
          'The browser worker stopped before it could return a normal program result.',
        suggestedFix:
          'Run the program again. If this repeats, refresh the page and check browser isolation support.',
        emoji: '🩺',
        category: 'runtime',
        diagnosticType: 'worker_crash',
        confidence: 0.95,
      };
    }

    return null;
  }

  private static inferDiagnosticType(
    rawError: string,
  ): DiagnosticType {
    const lowerError = rawError.toLowerCase();

    if (
      lowerError.includes('linker') ||
      lowerError.includes('undefined reference') ||
      lowerError.includes('wasm-ld')
    ) {
      return 'link_error';
    }

    if (
      lowerError.includes('error:') ||
      lowerError.includes('syntaxerror') ||
      lowerError.includes('compilation failed')
    ) {
      return 'compile_error';
    }

    if (
      lowerError.includes('internal error') ||
      lowerError.includes('unable to start')
    ) {
      return 'internal_error';
    }

    if (
      lowerError.includes('runtime error') ||
      lowerError.includes('exception') ||
      lowerError.includes('trap')
    ) {
      return 'runtime_error';
    }

    return 'unknown';
  }
}