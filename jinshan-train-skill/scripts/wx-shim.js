'use strict';

/**
 * 小程序运行时适配层。
 *
 * scripts/timetable.js 原样复用自微信小程序，内部依赖 wx.request 与
 * wx.getStorageSync / wx.setStorageSync。本模块在 Node 下用内置 http/https 与
 * 本地文件缓存模拟这套 API，从而零改动复用原有的三级降级逻辑：
 *   在线版本检查 → 版本不一致拉取线上 → 版本一致读缓存 → 网络异常且无缓存用内置兜底
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const CACHE_DIR = process.env.JSRAIL_CACHE_DIR
  || path.join(os.homedir(), '.workbuddy', 'jinshan-train-cache');

const pending = new Set();
const stats = { ok: 0, failed: 0 };
const logs = [];

// 始终指向真实的 stdout/stderr，不受 mute 影响，供调用方输出正式结果
const rawLog = console.log.bind(console);
const rawError = console.error.bind(console);

let muted = false;
const consoleOrig = {};

function cacheFile(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, safe + '.json');
}

function httpGet(urlStr, timeout, redirectCount) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlStr);
    } catch (e) {
      reject(new Error('非法 URL: ' + urlStr));
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.get(target, { timeout }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const next = (redirectCount || 0) + 1;
        if (next > 3) {
          reject(new Error('重定向次数过多'));
          return;
        }
        httpGet(new URL(res.headers.location, target).toString(), timeout, next).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: status, text: body }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

function request(options) {
  const {
    url, timeout = 8000, success, fail, complete,
  } = options || {};

  const base = httpGet(url, timeout)
    .then(({ statusCode, text }) => {
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = text;
      }
      stats.ok += 1;
      if (success) success({ statusCode, data, errMsg: 'request:ok' });
      return { statusCode, data };
    })
    .catch((err) => {
      stats.failed += 1;
      if (fail) fail({ errMsg: String((err && err.message) || err) });
      return null;
    });

  const tracked = base.then(
    (v) => { pending.delete(tracked); if (complete) complete(); return v; },
    (e) => { pending.delete(tracked); if (complete) complete(); throw e; },
  );
  pending.add(tracked);
  return tracked;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 等待所有 fire-and-forget 请求落地（holidays / suspension 是无回调的异步下载） */
async function waitIdle(timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (pending.size > 0 && Date.now() < deadline) {
    await sleep(50);
  }
  return pending.size === 0;
}

function mute() {
  if (muted) return;
  muted = true;
  ['log', 'info', 'warn', 'error'].forEach((key) => {
    consoleOrig[key] = console[key].bind(console);
    console[key] = (...args) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    };
  });
}

function unmute() {
  if (!muted) return;
  muted = false;
  Object.keys(consoleOrig).forEach((key) => {
    console[key] = consoleOrig[key];
    delete consoleOrig[key];
  });
}

function drainLogs() {
  return logs.splice(0, logs.length);
}

function isMuted() {
  return muted;
}

function hasCache(key) {
  try {
    return fs.statSync(cacheFile(key)).size > 0;
  } catch (e) {
    return false;
  }
}

function clearCache() {
  try {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    return true;
  } catch (e) {
    return false;
  }
}

global.wx = {
  request,
  getStorageSync(key) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile(key), 'utf8'));
    } catch (e) {
      return '';
    }
  },
  setStorageSync(key, value) {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile(key), JSON.stringify(value));
    } catch (e) {
      /* 缓存写入失败不影响查询，静默降级 */
    }
  },
  removeStorageSync(key) {
    try {
      fs.unlinkSync(cacheFile(key));
    } catch (e) { /* ignore */ }
  },
};

module.exports = {
  CACHE_DIR,
  request,
  waitIdle,
  mute,
  unmute,
  drainLogs,
  isMuted,
  hasCache,
  clearCache,
  rawLog,
  rawError,
  stats: () => ({ ...stats }),
};
