// A table's rows are made again at each render, and each handler in them
// (a cell's click, its commit, its focus) is a new function each time. On
// GTK a handler given anew is a signal let go and connected again, and
// every cell of every row built pays for it, though one row was edited.
// Steady keeps each place's last element. Its handlers go through
// stand-ins that call the latest one given, so a row whose elements are
// the same as last time, handlers aside, is given back as the very element
// it was, and React passes over it.

import { cloneElement, isValidElement, type ReactElement } from "react";

/** Arrays longer than this are compared as themselves, not item by item (a grid's every row id, say). */
const LONG = 64;

type Handler = (...args: unknown[]) => unknown;

interface Held {
  element: ReactElement | undefined;
  also: unknown;
  latest: Map<string, Handler>;
  standIns: Map<string, Handler>;
}

/**
 * A ref (`ref`, or a prop named like `cellRef`) is called again when it's a
 * new function: it is left as given, and not compared. A ref's own values
 * (its row's id, its column) show in the element's other props or keys, and
 * what else it reads is passed as `also`.
 */
const isRef = (name: string) => name === "ref" || name.endsWith("Ref");

const isPlain = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export class Steady {
  private held = new Map<string, Held>();

  /**
   * The element for the place `key`: the one given, or, when it is the same
   * as the place's last one (handlers aside, and `also` the same), that one.
   */
  take(key: string, element: ReactElement, also?: unknown): ReactElement {
    let held = this.held.get(key);
    if (!held) {
      held = { element: undefined, also: undefined, latest: new Map(), standIns: new Map() };
      this.held.set(key, held);
    }
    const next = steady(element, "", held) as ReactElement;
    if (held.element && Object.is(held.also, also) && same(held.element, next)) return held.element;
    held.element = next;
    held.also = also;
    return next;
  }
}

/** The value with each handler in it, however deep, swapped for its place's stand-in. */
function steady(value: unknown, path: string, held: Held): unknown {
  if (typeof value === "function") {
    held.latest.set(path, value as Handler);
    let standIn = held.standIns.get(path);
    if (!standIn) {
      standIn = (...args) => held.latest.get(path)!(...args);
      held.standIns.set(path, standIn);
    }
    return standIn;
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (value.length > LONG) return value;
    let changed = false;
    const out = value.map((item, i) => {
      const s = steady(item, `${path}.${i}`, held);
      if (s !== item) changed = true;
      return s;
    });
    return changed ? out : value;
  }
  if (isValidElement(value)) {
    const props = value.props as Record<string, unknown>;
    let next: Record<string, unknown> | undefined;
    for (const name of Object.keys(props)) {
      if (isRef(name)) continue;
      const s = steady(props[name], `${path}.${name}`, held);
      if (s !== props[name]) (next ??= {})[name] = s;
    }
    return next ? cloneElement(value, next) : value;
  }
  if (isPlain(value)) {
    const record = value as Record<string, unknown>;
    let next: Record<string, unknown> | undefined;
    for (const name of Object.keys(record)) {
      const s = steady(record[name], `${path}.${name}`, held);
      if (s !== record[name]) (next ??= { ...record })[name] = s;
    }
    return next ?? value;
  }
  return value;
}

/** Whether two steadied values show the same: elements by type, key and props (refs aside), the rest by value. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (isValidElement(a) || isValidElement(b)) {
    if (!isValidElement(a) || !isValidElement(b) || a.type !== b.type || a.key !== b.key) return false;
    return sameRecords(a.props as Record<string, unknown>, b.props as Record<string, unknown>, true);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length > LONG) return false;
    return a.every((item, i) => same(item, b[i]));
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  return sameRecords(a as Record<string, unknown>, b as Record<string, unknown>, false);
}

function sameRecords(a: Record<string, unknown>, b: Record<string, unknown>, props: boolean): boolean {
  const names = Object.keys(a).filter((name) => !(props && isRef(name)));
  if (names.length !== Object.keys(b).filter((name) => !(props && isRef(name))).length) return false;
  return names.every((name) => Object.hasOwn(b, name) && same(a[name], b[name]));
}
