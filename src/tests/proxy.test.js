import { jest } from '@jest/globals';
import { makeProxyRequest, makeParallelProxyRequests } from '../utils/proxyRequest.js';
import { getProxyAgent } from '../config/proxy.js';

describe('Proxy Implementation Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getProxyAgent creates correct proxy URL for country-code method', () => {
    const agent = getProxyAgent(0, 'country-code');
    expect(agent.proxy.host).toBe('pr.oxylabs.io');
    expect(agent.proxy.port).toBe('7777');
    expect(agent.proxy.auth).toContain('customer-');
    expect(agent.proxy.auth).toContain('-cc-US');
  });

  test('makeProxyRequest handles successful requests', async () => {
    const mockData = { test: 'data' };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const result = await makeProxyRequest('https://test.com', {}, 1);
    expect(result).toEqual(mockData);
  });

  test('makeProxyRequest retries on rate limit', async () => {
    const mockData = { test: 'data' };
    let attemptCount = 0;
    
    global.fetch = jest.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 429
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockData)
      });
    });

    const result = await makeProxyRequest('https://test.com', {}, 2);
    expect(result).toEqual(mockData);
    expect(attemptCount).toBe(2);
  });

  test('makeParallelProxyRequests handles multiple URLs', async () => {
    const urls = ['https://test1.com', 'https://test2.com'];
    const mockData = { test: 'data' };
    
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    });

    const results = await makeParallelProxyRequests(urls, {}, 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(mockData);
    expect(results[1]).toEqual(mockData);
  });

  test('makeParallelProxyRequests handles errors gracefully', async () => {
    const urls = ['https://test1.com', 'https://test2.com'];
    let attemptCount = 0;
    
    global.fetch = jest.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount === 1) {
        return Promise.reject(new Error('Test error'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ test: 'data' })
      });
    });

    const results = await makeParallelProxyRequests(urls, {}, 2);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ test: 'data' });
  });
}); 