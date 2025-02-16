import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Starting tests for OpenAI Unit Test Generator Extension.');

	test('Extension should be present and activated', async () => {
		// Get the extension using its identifier (usually "<publisher>.<extension-name>")
		// If you don't have a publisher set in package.json, use the extension's name.
		const extension = vscode.extensions.getExtension('openai-unit-test-generator');
		assert.ok(extension, 'Extension is not present');
		await extension!.activate();
		assert.ok(extension!.isActive, 'Extension is not activated');
	});

	test('Command "openai-unit-test-generator.generateTests" is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('openai-unit-test-generator.generateTests'), 'Generate Tests command is not registered');
	});

	test('Command "openai-unit-test-generator.setApiKey" is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('openai-unit-test-generator.setApiKey'), 'Set API Key command is not registered');
	});
});
