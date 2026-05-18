// This module owns translation from live input addresses into canvas coords.
// It is responsible for resolving controller, sequential, and generic MIDI
// note/channel addresses against the current controller map and coord resolver,
// including fixed-do controller remapping. It does not trigger notes, update
// modulation history, or derive scale-mode pitch matching.

function controllerLookupChannel(keys, rawChannel) {
  return keys.controller?.multiChannel ? rawChannel : 1;
}

function resolveControllerCoords(keys, channel, note, rawChannel = channel) {
  if (!keys.controllerMap) return null;
  const lookupChannel = controllerLookupChannel(keys, channel);
  const baseCoords = keys.controllerMap.get(`${lookupChannel}.${note}`) ?? null;
  if (baseCoords === null) return null;
  const resolved = keys.controller?.applyChannelOffsetOnMap
    ? keys._applyChannelOffset(baseCoords, rawChannel)
    : baseCoords;
  return keys._modulatedControllerCoords(resolved);
}

function resolveGenericCoords(keys, channel, note) {
  return keys._modulatedControllerCoords(keys.coordResolver.coordForSteps(
    keys.coordResolver.noteToSteps(note, channel),
    { channel, note },
  ));
}

export function coordsForLiveInputAddress(keys, inputAddress) {
  if (!inputAddress) return null;
  if (keys.inputRuntime.layoutMode !== "sequential" && keys.controllerMap) {
    return resolveControllerCoords(
      keys,
      inputAddress.channel,
      inputAddress.note,
      inputAddress.rawChannel ?? inputAddress.channel,
    );
  }
  return resolveGenericCoords(keys, inputAddress.channel, inputAddress.note);
}

export function resolveNonScaleNoteOn(keys, event) {
  if (keys.inputRuntime.layoutMode === "sequential") {
    const normalized = keys._normalizeInputAddress(event.message.channel, event.note.number);
    if (!normalized) return null;
    return {
      liveInputAddress: {
        channel: normalized.channel,
        note: normalized.note,
        rawChannel: event.message.channel,
      },
      coords: resolveGenericCoords(keys, normalized.channel, normalized.note),
    };
  }

  if (keys.controllerMap) {
    const lookupChannel = controllerLookupChannel(keys, event.message.channel);
    return {
      liveInputAddress: {
        channel: lookupChannel,
        note: event.note.number,
        rawChannel: event.message.channel,
      },
      coords: resolveControllerCoords(keys, lookupChannel, event.note.number, event.message.channel),
    };
  }

  return {
    liveInputAddress: {
      channel: event.message.channel,
      note: event.note.number,
      rawChannel: event.message.channel,
    },
    coords: resolveGenericCoords(keys, event.message.channel, event.note.number),
  };
}

export function resolveNonScaleNoteOffCoords(keys, channel, note, rawChannel = channel) {
  if (keys.inputRuntime.layoutMode === "sequential" || !keys.controllerMap) {
    const normalized = keys._normalizeInputAddress(rawChannel, note);
    return normalized
      ? keys.coordResolver.stepsToVisibleCoords(
          keys.coordResolver.noteToSteps(normalized.note, normalized.channel),
        ).map((coords) => keys._modulatedControllerCoords(coords))
      : [];
  }

  const coords = resolveControllerCoords(keys, channel, note, rawChannel);
  return coords ? [coords] : [];
}
