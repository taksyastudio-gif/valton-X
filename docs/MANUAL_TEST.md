# Manual Testing Instructions for forgebyteX Python Implementation

## Prerequisites
- Dev server running: `npm run dev`
- Browser open to: http://localhost:5173

## Test 1: Python Basic Execution
1. Click on `main.py` in the file explorer
2. Verify the editor contains:
   ```python
   print("Hello from Python in forgebyteX!")
   
   for i in range(5):
       print(i)
   ```
3. Click "Run Code" (or press F5)
4. Wait for Pyodide initialization (first run takes 10-15 seconds)
5. **Expected Result**: Terminal displays:
   ```
   > Running main.py…
   Hello from Python in forgebyteX!
   0
   1
   2
   3
   4
   > Process exited with code 0.
   ```

## Test 2: Python Syntax Error Handling
1. With `main.py` still selected, replace the code with:
   ```python
   print("Hello from Python in forgebyteX!")
   for i in range(5)
       print(i)
   ```
2. Click "Run Code"
3. **Expected Result**: 
   - Worker does not crash
   - UI remains responsive
   - Terminal displays a Python syntax error message
   - Execution status shows "Failed"

## Test 3: C Pipeline Regression
1. Click "Clear" to clear terminal
2. Click on `main.c` in the file explorer
3. Verify the editor contains:
   ```c
   #include <stdio.h>
   
   int main() {
       printf("Hello forgebyteX!\n");
       return 0;
   }
   ```
4. If needed, click "Reset" to restore original content
5. Change to:
   ```c
   #include <stdio.h>
   
   int main() {
       printf("Hello from C in forgebyteX!\n");
       return 0;
   }
   ```
6. Click "Run Code"
7. **Expected Result**: Terminal displays:
   ```
   > Compiling main.c…
   Hello from C in forgebyteX!
   > Process exited with code 0.
   ```

## Test 4: Multi-language Regression (C → Python → C → Python)
1. Clear terminal
2. Run C code (main.c) - observe output
3. Clear terminal, switch to Python (main.py), run - observe output
4. Clear terminal, switch back to C (main.c), run - observe output
5. Clear terminal, switch to Python (main.py), run - observe output

**Expected Results**:
- Correct runtime selected each time
- No output leakage between languages
- No duplicate output on repeated runs
- Worker lifecycle remains stable
- Terminal streaming works correctly

## Test 5: Error Recovery
1. Run the buggy Python code from Test 2
2. Clear terminal
3. Restore correct Python code:
   ```python
   print("Hello from Python in forgebyteX!")
   
   for i in range(5):
       print(i)
   ```
4. Run again
5. **Expected Result**: Code runs successfully after error

## Build & Lint Status
✅ Build: `npm run build` - PASSED
✅ Lint: `npm run lint` - PASSED

## Implementation Details
- **Python Runtime**: Pyodide v0.25.0 (CPython compiled to WebAssembly)
- **Architecture**: Follows existing C pipeline pattern
  - `python.worker.ts` - Pyodide runtime worker
  - `python-client.ts` - Client facade using shared ExecutionClient
  - Integrated into App.tsx with language detection
- **Status**: Added 'preparing' status for Pyodide initialization
