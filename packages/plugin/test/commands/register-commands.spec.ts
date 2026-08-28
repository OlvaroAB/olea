/**
 * `register-commands.ts` tests. Runs against a fake `CommandRegistrar` —
 * this file never imports `obsidian`, same reasoning as
 * `test/ingestion/queue-store.spec.ts` (see `commands/types.ts`'s module
 * doc): `CommandRegistrar` is a narrow local port a plain object can
 * satisfy, so command registration is testable without a real Obsidian
 * host.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  OLEA_COMMAND_BULK_REVIEW_OPEN,
  OLEA_COMMAND_CREATE_CARD,
  OLEA_COMMAND_DIAGNOSTICS_COPY,
  OLEA_COMMAND_GAP_OPEN,
  OLEA_COMMAND_OPEN,
  OLEA_COMMAND_RETROSPECTIVE_OPEN,
  OLEA_COMMAND_REVIEW_START,
  OLEA_COMMAND_SESSION_BUILD,
  OLEA_COMMAND_TODAY_OPEN,
} from '../../src/commands/ids.js';
import {
  buildOleaCommands,
  type OleaCommandHandlers,
  registerOleaCommands,
} from '../../src/commands/register-commands.js';
import type { CommandRegistrar, OleaCommandSpec } from '../../src/commands/types.js';

/** Stands in for a real `Plugin`'s `addCommand`, recording every call. */
class FakeCommandRegistrar implements CommandRegistrar {
  readonly registered: OleaCommandSpec[] = [];

  addCommand(command: OleaCommandSpec): unknown {
    this.registered.push(command);
    return command;
  }
}

function fakeHandlers(): OleaCommandHandlers {
  return {
    startReview: vi.fn(),
    createCard: vi.fn(),
    openToday: vi.fn(),
    openGap: vi.fn(),
    buildSession: vi.fn(),
    openBulkReview: vi.fn(),
    openRetrospective: vi.fn(),
    copyDiagnostics: vi.fn(),
  };
}

describe('buildOleaCommands', () => {
  it('registers exactly the nine command ids (review, create, today, open, gap, session, bulk-review, retrospective, diagnostics) — ol-2tyj added "gap", ol-p5t06b added "session", ol-jie3 added "bulk-review", ol-r68l added "retrospective", ol-p6t02 added "diagnostics"; the withdrawn "draft cards" command (F4.5) is not among them', () => {
    const commands = buildOleaCommands(fakeHandlers());
    expect(commands.map((c) => c.id).sort()).toEqual(
      [
        OLEA_COMMAND_BULK_REVIEW_OPEN,
        OLEA_COMMAND_CREATE_CARD,
        OLEA_COMMAND_DIAGNOSTICS_COPY,
        OLEA_COMMAND_GAP_OPEN,
        OLEA_COMMAND_OPEN,
        OLEA_COMMAND_RETROSPECTIVE_OPEN,
        OLEA_COMMAND_REVIEW_START,
        OLEA_COMMAND_SESSION_BUILD,
        OLEA_COMMAND_TODAY_OPEN,
      ].sort(),
    );
  });

  it('every command name is prefixed "Olea: " so it reads consistently in the command palette', () => {
    for (const command of buildOleaCommands(fakeHandlers())) {
      expect(command.name.startsWith('Olea: ')).toBe(true);
    }
  });

  it('the Today command and the "Open Olea" command both carry the default hotkeys F7.7 names, and the other two carry none', () => {
    const commands = buildOleaCommands(fakeHandlers());
    const byId = Object.fromEntries(commands.map((c) => [c.id, c]));

    expect(byId[OLEA_COMMAND_TODAY_OPEN]?.hotkeys).toEqual([{ modifiers: ['Alt'], key: '1' }]);
    expect(byId[OLEA_COMMAND_OPEN]?.hotkeys).toEqual([{ modifiers: ['Mod', 'Shift'], key: 'O' }]);
    expect(byId[OLEA_COMMAND_REVIEW_START]?.hotkeys).toBeUndefined();
    expect(byId[OLEA_COMMAND_CREATE_CARD]?.hotkeys).toBeUndefined();
    expect(byId[OLEA_COMMAND_GAP_OPEN]?.hotkeys).toBeUndefined();
    expect(byId[OLEA_COMMAND_SESSION_BUILD]?.hotkeys).toBeUndefined();
    expect(byId[OLEA_COMMAND_BULK_REVIEW_OPEN]?.hotkeys).toBeUndefined();
    expect(byId[OLEA_COMMAND_RETROSPECTIVE_OPEN]?.hotkeys).toBeUndefined();
    expect(byId[OLEA_COMMAND_DIAGNOSTICS_COPY]?.hotkeys).toBeUndefined();
  });

  it('wires each command callback to its matching handler', () => {
    const handlers = fakeHandlers();
    const commands = buildOleaCommands(handlers);
    const byId = Object.fromEntries(commands.map((c) => [c.id, c]));

    byId[OLEA_COMMAND_REVIEW_START]?.callback();
    byId[OLEA_COMMAND_CREATE_CARD]?.callback();
    byId[OLEA_COMMAND_TODAY_OPEN]?.callback();
    byId[OLEA_COMMAND_OPEN]?.callback();
    byId[OLEA_COMMAND_GAP_OPEN]?.callback();
    byId[OLEA_COMMAND_SESSION_BUILD]?.callback();
    byId[OLEA_COMMAND_BULK_REVIEW_OPEN]?.callback();
    byId[OLEA_COMMAND_RETROSPECTIVE_OPEN]?.callback();
    byId[OLEA_COMMAND_DIAGNOSTICS_COPY]?.callback();

    expect(handlers.startReview).toHaveBeenCalledTimes(1);
    expect(handlers.createCard).toHaveBeenCalledTimes(1);
    // "Open Olea" is David's ruling (ol-f77commands): another door onto the
    // same Today panel, so it shares openToday rather than getting its own
    // handler — asserted here as *two* calls to the one handler, not one
    // call each to two different handlers.
    expect(handlers.openToday).toHaveBeenCalledTimes(2);
    expect(handlers.openGap).toHaveBeenCalledTimes(1);
    expect(handlers.buildSession).toHaveBeenCalledTimes(1);
    expect(handlers.openBulkReview).toHaveBeenCalledTimes(1);
    expect(handlers.openRetrospective).toHaveBeenCalledTimes(1);
    expect(handlers.copyDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('"explain something back" is not registered — David\'s ruling points existing commands at the Today panel, it does not manufacture a destination for contextual AI that is not built', () => {
    const commands = buildOleaCommands(fakeHandlers());
    for (const command of commands) {
      expect(command.name.toLowerCase()).not.toContain('explain');
    }
  });

  it('"Copy diagnostics" is left out of the palette entirely when no handler is supplied — same choice this file already made for "open Olea"/"explain something back" while they had no destination (ol-p6t02: main.ts has not been wired yet)', () => {
    const { copyDiagnostics: _omitted, ...handlersWithoutDiagnostics } = fakeHandlers();
    const commands = buildOleaCommands(handlersWithoutDiagnostics);
    expect(commands.some((c) => c.id === OLEA_COMMAND_DIAGNOSTICS_COPY)).toBe(false);
  });
});

describe('registerOleaCommands', () => {
  it('calls addCommand on the registrar once per command, in the same shape buildOleaCommands produces', () => {
    const registrar = new FakeCommandRegistrar();
    registerOleaCommands(registrar, fakeHandlers());

    expect(registrar.registered).toHaveLength(9);
    expect(registrar.registered.map((c) => c.id).sort()).toEqual(
      [
        OLEA_COMMAND_BULK_REVIEW_OPEN,
        OLEA_COMMAND_CREATE_CARD,
        OLEA_COMMAND_DIAGNOSTICS_COPY,
        OLEA_COMMAND_GAP_OPEN,
        OLEA_COMMAND_OPEN,
        OLEA_COMMAND_RETROSPECTIVE_OPEN,
        OLEA_COMMAND_REVIEW_START,
        OLEA_COMMAND_SESSION_BUILD,
        OLEA_COMMAND_TODAY_OPEN,
      ].sort(),
    );
  });

  it('registers OLEA_COMMAND_OPEN specifically — proves the registrar sees the new command id, not just a count', () => {
    const registrar = new FakeCommandRegistrar();
    registerOleaCommands(registrar, fakeHandlers());

    expect(registrar.registered.some((c) => c.id === OLEA_COMMAND_OPEN)).toBe(true);
  });
});
