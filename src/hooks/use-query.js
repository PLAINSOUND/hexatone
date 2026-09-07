/**
 * src/hooks/use-query.js
 *
 * Small persistence/query bridge used by App settings state.
 *
 * It defines the Extract helpers for serialising values to URLSearchParams and
 * localStorage, and the `useQuery` hook that layers URL values over defaults
 * and writes updates back out.
 */
import { useState, useEffect, useRef } from "preact/hooks";

export class Extract {
  constructor(from, to) {
    this.to = to;
    this.from = from;
  }

  extract(query, key) {
    if (query.has(key)) {
      return this.from(query.get(key));
    } else {
      return null;
    }
  }

  insert(query, key, value) {
    query.set(key, this.to(value));
  }

  restore(key) {
    return this.from(localStorage.getItem(key));
  }

  store(key, value) {
    localStorage.setItem(key, this.to(value));
  }
}

export class ExtractArray {
  constructor(from, to) {
    this.to = to;
    this.from = from;
  }

  extract(query, key) {
    if (query.has(key)) {
      return query.getAll(key).map(this.from);
    } else {
      return null;
    }
  }
  insert(query, key, values) {
    values.map(this.to).forEach((v) => query.append(key, v));
  }

  restore(_key) {
    return null; // TODO
  }

  store(_key, _value) {
    return null; // TODO
  }
}

export const ExtractString = new Extract(
  (x) => x,
  (x) => x,
);
export const ExtractStringArray = new ExtractArray(
  (x) => x,
  (x) => x,
);
export const ExtractJoinedString = new Extract(
  (x) => x.split(","),
  (x) => x.join(","),
);
export const ExtractFloat = new Extract(
  (x) => Number.parseFloat(x),
  (x) => x.toString(),
);
export const ExtractFloatArray = new Extract(
  (x) => Number.parseFloat(x),
  (x) => x.toString(),
);
export const ExtractInt = new Extract(
  (x) => Number.parseInt(x),
  (x) => x.toString(),
);
export const ExtractIntArray = new Extract(
  (x) => Number.parseInt(x),
  (x) => x.toString(),
);
export const ExtractBool = new Extract(
  (x) => x === "true",
  (x) => x.toString(),
);
export const ExtractBoolArray = new Extract(
  (x) => x === "true",
  (x) => x.toString(),
);

function shouldPersistQueryValue(value) {
  return value !== null && value !== undefined;
}

export function useQuery(spec, defaults, skipKeys = [], localStorageSkipKeys = skipKeys) {
  const [values, setValues] = useState(() => {
    localStorageSkipKeys.forEach((key) => localStorage.removeItem(key));
    const initial = { ...defaults };
    const query = new URLSearchParams(document.location.search.substring(1));
    const fromUrl = document.location.search.length > 0;
    for (const [key, extract] of Object.entries(spec)) {
      if (fromUrl) {
        if (!skipKeys.includes(key) && query.has(key)) initial[key] = extract.extract(query, key);
      } else if (!localStorageSkipKeys.includes(key) && localStorage.getItem(key) !== null) {
        initial[key] = extract.restore(key);
      }
    }
    return initial;
  });
  // Keep serialized values, not just object identities: callers may construct
  // equal arrays during a settings update. The first commit still persists defaults.
  const persistedValuesRef = useRef(new Map());
  const valuesRef = useRef(values);
  valuesRef.current = values;

  function handle(_e) {
    const query = new URLSearchParams(document.location.search.substring(1));
    const output = {};
    for (let [key, extract] of Object.entries(spec)) {
      if (query.has(key)) {
        output[key] = extract.extract(query, key);
      }
    }
    valuesRef.current = output;
    persistedValuesRef.current.clear();
    setValues(output);
  }

  function setState(next_f, options = {}) {
    const { updateUrl = true } = options;
    const query = new URLSearchParams();
    const next = next_f(valuesRef.current);
    // Update the ref immediately so that multiple synchronous setState calls
    // within the same event handler each compose on top of the previous result,
    // rather than all computing from the same pre-render snapshot.
    valuesRef.current = next;
    for (let [key, extract] of Object.entries(spec)) {
      if (skipKeys.includes(key)) continue;
      if (key in next && shouldPersistQueryValue(next[key])) {
        extract.insert(query, key, next[key]);
        if (!localStorageSkipKeys.includes(key)) {
          const encoded = extract instanceof Extract ? extract.to(next[key]) : null;
          if (!persistedValuesRef.current.has(key) || persistedValuesRef.current.get(key) !== encoded) {
            extract.store(key, next[key]);
            persistedValuesRef.current.set(key, encoded);
          }
        }
      }
    }
    if (updateUrl) {
      const url = new URL(location.toString());
      url.search = query.toString();
      if (url.href !== location.href) history.replaceState({}, "Hexatone WebApp", url);
    }

    setValues(next);
  }

  useEffect(() => {
    window.addEventListener("popstate", handle);
    return () => {
      window.removeEventListener("popstate", handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // handle reads from valuesRef to avoid stale closure — intentionally registered once

  return [values, setState];
}

export default useQuery;
