/**
 * Tests for AgentLensClient lesson methods — deprecated stubs
 */
import { describe, it, expect } from 'vitest';
import { AgentLensClient } from '../client.js';

const EXPECTED_ERROR = 'Lesson methods removed from AgentLens SDK. Use lore-sdk: https://github.com/amitpaz1/lore';

function createClient() {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'als_test123',
  });
}

describe('AgentLensClient deprecated lesson methods', () => {
  it('createLesson throws deprecation error', async () => {
    const client = createClient();
    await expect(client.createLesson()).rejects.toThrow(EXPECTED_ERROR);
  });

  it('getLessons throws deprecation error', async () => {
    const client = createClient();
    await expect(client.getLessons()).rejects.toThrow(EXPECTED_ERROR);
  });

  it('getLesson throws deprecation error', async () => {
    const client = createClient();
    await expect(client.getLesson()).rejects.toThrow(EXPECTED_ERROR);
  });

  it('updateLesson throws deprecation error', async () => {
    const client = createClient();
    await expect(client.updateLesson()).rejects.toThrow(EXPECTED_ERROR);
  });

  it('deleteLesson throws deprecation error', async () => {
    const client = createClient();
    await expect(client.deleteLesson()).rejects.toThrow(EXPECTED_ERROR);
  });
});
