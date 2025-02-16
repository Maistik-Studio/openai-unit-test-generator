import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

// Helper function to extract relative import statements based on language.
function extractImports(content: string, ext: string): string {
  let importLines: string[] = [];
  if (ext === '.js' || ext === '.ts') {
    // Regex to capture module specifiers from ES module or require statements.
    // Group 1: specifier in an ES module import
    // Group 2: specifier in a CommonJS require
    const regex = /^(?:import\s+.*?\s+from\s+['"](.*?)['"]|(?:const\s+.*?\s*=\s*require\(['"](.*?)['"]\)))/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      // Use the captured module specifier from either group.
      const modulePath = match[1] || match[2];
      // Only include relative paths.
      if (modulePath && (modulePath.startsWith('./') || modulePath.startsWith('../'))) {
        importLines.push(match[0]);
      }
    }
  } else if (ext === '.py') {
    // For Python, relative imports typically start with "from ." or "from .."
    const regex = /^(from\s+(\.+\S*)\s+import\s+.*)/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      importLines.push(match[0]);
    }
  }
  return importLines.join('\n');
}

export function activate(context: vscode.ExtensionContext) {
  // Command: Generate Unit Tests for the Active File.
  // This command can be invoked either from the Command Palette or via right-click (Explorer context).
  const generateCommand = vscode.commands.registerCommand('openai-unit-test-generator.generateTests', async (uri?: vscode.Uri) => {
    const config = vscode.workspace.getConfiguration('openai-unit-test-generator');
    const apiKey: string = config.get('apiKey', '');
    const mainModel: string = config.get('mainModel', 'o3-mini');
    const fallbackModel: string = config.get('fallbackModel', 'o3-mini');

    // If API key is not set, show a warning with an action to set it.
    if (!apiKey) {
      vscode.window
        .showWarningMessage("Your OpenAI API key is not set.", "Set API Key")
        .then(selection => {
          if (selection === "Set API Key") {
            vscode.commands.executeCommand("openai-unit-test-generator.setApiKey");
          }
        });
      return;
    }

    // Determine the target document:
    // If a URI is provided (from Explorer context), open that document.
    // Otherwise, use the active editor's document.
    let document: vscode.TextDocument | undefined;
    if (uri) {
      document = await vscode.workspace.openTextDocument(uri);
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Please open a file for which you want to generate unit tests.');
        return;
      }
      document = editor.document;
    }

    const fileContent = document.getText();
    const originalFileName = path.basename(document.fileName);
    const ext = path.extname(originalFileName).toLowerCase();
    const baseName = path.basename(originalFileName, ext);
    let testFileName: string;

    // Determine test file name based on the file extension.
    if (ext === '.ts') {
      testFileName = `${baseName}.spec.ts`;
    } else if (ext === '.js') {
      testFileName = `${baseName}.spec.js`;
    } else if (ext === '.py') {
      testFileName = `${baseName}_test.py`;
    } else {
      testFileName = `unit-tests-${originalFileName}`;
    }

    const fileDir = path.dirname(document.uri.fsPath);
    const testFilePath = path.join(fileDir, testFileName);

    if (fs.existsSync(testFilePath)) {
      vscode.window.showErrorMessage(`Test file ${testFileName} already exists in ${fileDir}.`);
      return;
    }

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(sync~spin) Generating Unit Tests for ${originalFileName}...`;
    statusBarItem.show();

    // Extract relative import statements.
    const importContext = extractImports(fileContent, ext);
    const languageName = ext === '.py' ? "Python" : (ext === '.ts' ? "TypeScript" : (ext === '.js' ? "JavaScript" : "the appropriate language"));

    // Improved prompt with strong instructions for complete, 100% test coverage.
    const prompt = `You are an expert unit test generation bot with a focus on complete test coverage. Your task is to generate comprehensive and fully complete unit tests for the provided ${languageName} code. The generated tests must:
- Cover 100% of the code paths, including every function, method, and conditional branch.
- Include tests for both typical and edge-case inputs, as well as error handling where applicable.
- Ensure that all scenarios and potential failures are tested to achieve full code coverage.
- Be written in ${languageName} using the best practices and conventions of the respective testing framework.
- Include all necessary import statements and setup code required to run the tests.

Code Context:
----------------
Relative Import Statements:
${importContext ? importContext : "No relative import statements found."}

Full Code:
${fileContent}

Provide ONLY the test code enclosed in a regular code block without any additional commentary. If it is not possible to generate unit tests, output exactly "not possible00192".\n\n`;

    // Type assertion to satisfy the expected type for messages.
    const messages = ([
      { role: "system", content: prompt },
      { role: "user", content: fileContent }
    ] as unknown) as OpenAI.Chat.ChatCompletionMessageParam[];

    // Initialize the OpenAI client.
    const client = new OpenAI({ apiKey });

    // Helper function to generate tests using a given model.
    async function generateTests(model: string) {
      return await client.chat.completions.create({
        model: model,
        messages: messages
      });
    }

    let result;
    try {
      result = await generateTests(mainModel);
    } catch (error) {
      console.error("Error using main model:", error);
      // Try fallback model if available and different.
      if (fallbackModel && fallbackModel !== mainModel) {
        try {
          result = await generateTests(fallbackModel);
        } catch (fallbackError) {
          console.error("Error using fallback model:", fallbackError);
          vscode.window.showInformationMessage("Error generating tests with both main and fallback models.");
          statusBarItem.text = "Error Generating Tests";
          setTimeout(() => statusBarItem.dispose(), 1000);
          return;
        }
      } else {
        vscode.window.showInformationMessage("Error generating tests.");
        statusBarItem.text = "Error Generating Tests";
        setTimeout(() => statusBarItem.dispose(), 1000);
        return;
      }
    }

    let responseText = result.choices[0].message?.content?.trim() || "";

    // Remove code block markers if present.
    if (responseText.startsWith("```")) {
      responseText = responseText.substring(3);
      responseText = responseText.replace(/^\w+\n/, ""); // Remove language identifier if present.
    }
    if (responseText.endsWith("```")) {
      responseText = responseText.substring(0, responseText.length - 3);
    }

    if (responseText.includes("not possible00192")) {
      vscode.window.showInformationMessage("Couldn't generate unit tests for this file. Try a different file.");
      statusBarItem.text = "Failed to Generate Tests";
      setTimeout(() => statusBarItem.dispose(), 1000);
      return;
    }

    try {
      fs.writeFileSync(testFilePath, responseText);
      const doc = await vscode.workspace.openTextDocument(testFilePath);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage(`${testFileName} generated successfully.`);
      statusBarItem.text = "$(check) Test File Generated!";
      setTimeout(() => statusBarItem.dispose(), 1000);
    } catch (writeError) {
      vscode.window.showErrorMessage("Error writing the test file.");
      statusBarItem.text = "Error Writing File";
      setTimeout(() => statusBarItem.dispose(), 1000);
    }
  });

  // Command: Set/Update API Key.
  const setApiKeyCommand = vscode.commands.registerCommand('openai-unit-test-generator.setApiKey', async () => {
    const input = await vscode.window.showInputBox({
      prompt: "Please enter your OpenAI API Key",
      password: true
    });
    if (input) {
      await vscode.workspace.getConfiguration('openai-unit-test-generator')
        .update('apiKey', input, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage("OpenAI API Key updated successfully.");
    } else {
      vscode.window.showErrorMessage("API key not entered. Please try again.");
    }
  });

  context.subscriptions.push(generateCommand, setApiKeyCommand);
}

export function deactivate(): void {}
