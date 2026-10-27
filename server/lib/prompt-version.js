'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { state, systemPromptPath } = require('./state');

function getReleasePath() {
  return process.env.RELEASE_PATH || path.join(__dirname, '..', '..', 'release.json');
}

function getReleaseVersion() {
  return JSON.parse(fs.readFileSync(getReleasePath(), 'utf8')).version;
}

function nextPromptVersion(version) {
  const match = /^(\d+\.\d+\.\d+)([a-z]*)$/.exec(version);
  if (!match) throw new Error('Release version must contain three numbers and an optional lowercase letter suffix.');
  const letters = [...match[2]];
  let index = letters.length - 1;
  while (index >= 0 && letters[index] === 'z') {
    letters[index] = 'a';
    index -= 1;
  }
  if (index < 0) letters.unshift('a');
  else letters[index] = String.fromCharCode(letters[index].charCodeAt(0) + 1);
  return `${match[1]}${letters.join('')}`;
}

function saveVersionedPrompt(prompt) {
  const nextPrompt = prompt.trim();
  const releasePath = getReleasePath();
  const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  if (nextPrompt === state.systemPrompt.trim()) {
    return { systemPrompt: state.systemPrompt, version: release.version, changed: false };
  }
  const version = nextPromptVersion(release.version);
  const previousPrompt = fs.existsSync(systemPromptPath) ? fs.readFileSync(systemPromptPath, 'utf8') : null;
  const suffix = `.tmp-${crypto.randomUUID()}`;
  const promptTemp = `${systemPromptPath}${suffix}`;
  const releaseTemp = `${releasePath}${suffix}`;
  let promptWritten = false;
  try {
    // Stage both files before replacing either, and restore the prompt if the
    // version cannot be committed. Publish in-memory state only after success.
    fs.writeFileSync(promptTemp, `${nextPrompt}\n`, 'utf8');
    fs.writeFileSync(releaseTemp, `${JSON.stringify({ ...release, version }, null, 2)}\n`, 'utf8');
    fs.renameSync(promptTemp, systemPromptPath);
    promptWritten = true;
    fs.renameSync(releaseTemp, releasePath);
  } catch (error) {
    if (promptWritten) {
      if (previousPrompt === null) fs.rmSync(systemPromptPath, { force: true });
      else fs.writeFileSync(systemPromptPath, previousPrompt, 'utf8');
    }
    throw error;
  } finally {
    fs.rmSync(promptTemp, { force: true });
    fs.rmSync(releaseTemp, { force: true });
  }
  state.systemPrompt = nextPrompt;
  state.releaseVersion = version;
  return { systemPrompt: nextPrompt, version, changed: true };
}

module.exports = { getReleaseVersion, nextPromptVersion, saveVersionedPrompt };
