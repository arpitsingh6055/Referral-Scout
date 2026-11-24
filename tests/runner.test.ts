import { describe, expect, it } from 'vitest';
import { readSession } from '../src/background/runner';
import type { ApplySession } from '../src/background/apply';

const NOW = 1_700_000_000_000;

const session = (over: Partial<ApplySession> = {}): ApplySession => ({
  tabId: 1,
  url: 'https://boards.greenhouse.io/x/jobs/1',
  stage: 'filling',
  message: '',
  startedAt: NOW,
  updatedAt: NOW,
  step: '',
  stepCount: 1,
  summary: '',
  filled: [],
  files: [],
  ask: [],
  leftForYou: [],
  hasNext: false,
  hasSubmit: false,
  captcha: false,
  ...over,
});

describe('reading the fill engine', () => {
  it('reports a confirmed send as submitted', () => {
    const r = readSession(session({ sent: { at: NOW, referral: 'queued', message: 'Sent' } }), NOW);
    expect(r.state).toBe('submitted');
    expect(r.confirmed).toBe(true);
  });

  it('calls a submit with no confirmation uncertain, and raises it for the person', () => {
    const r = readSession(session({ autoSent: true, updatedAt: NOW - 60_000 }), NOW);
    expect(r.state).toBe('uncertain');
    expect(r.exception?.kind).toBe('submission-uncertain');
    expect(r.submitPressed).toBe(true);
  });

  it('gives a just-pressed submit a moment to confirm before calling it uncertain', () => {
    expect(readSession(session({ autoSent: true, updatedAt: NOW - 2000 }), NOW).state).not.toBe('uncertain');
  });

  it('never treats a confirmed send as uncertain, whatever else is set', () => {
    const r = readSession(session({ autoSent: true, updatedAt: NOW - 60_000, sent: { at: NOW, referral: 'off', message: '' } }), NOW);
    expect(r.state).toBe('submitted');
  });

  it('parks a security challenge without trying to answer it', () => {
    const r = readSession(session({ captcha: true }), NOW);
    expect(r.state).toBe('needs-you');
    expect(r.exception?.kind).toBe('security');
    expect(r.exception?.prompt).toContain('Complete it');
  });

  it('parks a sign-in step and points at the open tab', () => {
    expect(readSession(session({ waitSignIn: true }), NOW).exception?.kind).toBe('auth');
    expect(readSession(session({ stage: 'permission' }), NOW).exception?.kind).toBe('auth');
  });

  it('turns each unanswered question into its own inbox item', () => {
    const r = readSession(
      session({
        stage: 'review',
        ask: [
          { id: 'f1', frame: 0, label: 'PIN code', question: 'What is your PIN code?' },
          { id: 'f2', frame: 0, label: 'Relocate', question: 'Are you willing to relocate?', options: ['Yes', 'No'] },
        ],
      }),
      NOW,
    );
    expect(r.state).toBe('needs-you');
    expect(r.questions).toHaveLength(2);
    expect(r.questions![1]!.options).toEqual(['Yes', 'No']);
  });

  it('puts a security check above an unanswered question, since it blocks the page', () => {
    const r = readSession(session({ captcha: true, ask: [{ id: 'f1', frame: 0, label: 'PIN', question: 'PIN?' }] }), NOW);
    expect(r.exception?.kind).toBe('security');
  });

  it('calls a finished form ready once there is a submit and nothing further to fill', () => {
    expect(readSession(session({ stage: 'review', hasSubmit: true, hasNext: false }), NOW).state).toBe('ready');
    expect(readSession(session({ stage: 'done' }), NOW).state).toBe('ready');
  });

  it('keeps a mid-form review as filling rather than claiming it is ready', () => {
    expect(readSession(session({ stage: 'review', hasSubmit: false, hasNext: true }), NOW).state).toBe('filling');
  });

  it('turns an engine error into a retryable page problem, not a silent stop', () => {
    const r = readSession(session({ stage: 'error', message: 'The page changed; press Fill again.' }), NOW);
    expect(r.state).toBe('failed');
    expect(r.exception?.kind).toBe('page-failure');
    expect(r.note).toContain('page changed');
  });

  it('treats a missing session as still opening rather than failed', () => {
    expect(readSession(undefined, NOW).state).toBe('opening');
  });
});
