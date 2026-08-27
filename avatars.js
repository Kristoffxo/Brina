/* ============================================================
   Brina — mood avatars.

   Shared by the chat (where someone picks one) and the console
   (where the listener sees it). Defined once here so the two
   sides can never drift apart and show different things.

   The marks are deliberately abstract rather than faces. A grid
   of cartoon expressions would make this feel like a quiz; a
   quiet geometric mark carries the same information without
   asking someone to perform a feeling. Colours are muted and
   sit inside the brand palette rather than shouting over it.
   ============================================================ */

(function () {
  'use strict';

  // stroke paths are drawn in a 40x40 box, centred on y=22.
  var MOODS = [
    {
      id: 'okay',
      label: 'Okay',
      colour: '#7C8B7A',
      // a level line — nothing in particular
      path: 'M12 22 H28'
    },
    {
      id: 'happy',
      label: 'Happy',
      colour: '#B08E3F',
      // an open upward arc
      path: 'M12 20 Q20 28 28 20'
    },
    {
      id: 'excited',
      label: 'Excited',
      colour: '#C0714A',
      // upward arc with two small rays lifting off it
      path: 'M12 22 Q20 30 28 22 M14 13 L16 16 M26 13 L24 16'
    },
    {
      id: 'calm',
      label: 'Calm',
      colour: '#6F9A93',
      // a slow wave, settled
      path: 'M11 22 Q15 18 20 22 T29 22'
    },
    {
      id: 'lonely',
      label: 'Lonely',
      colour: '#87799C',
      // one small mark with a lot of space around it
      path: 'M20 22 h0.01 M12 22 h1 M27 22 h1'
    },
    {
      id: 'tired',
      label: 'Tired',
      colour: '#93887C',
      // a heavy line, sagging
      path: 'M12 21 Q20 25 28 21'
    },
    {
      id: 'anxious',
      label: 'Anxious',
      colour: '#B8913F',
      // a line that will not sit still
      path: 'M11 22 L15 18 L19 25 L23 18 L27 24 L29 21'
    },
    {
      id: 'sad',
      label: 'Sad',
      colour: '#67789A',
      // a downward arc
      path: 'M12 25 Q20 17 28 25'
    },
    {
      id: 'numb',
      label: 'Numb',
      colour: '#8B8B8B',
      // a broken line — present, but not quite there
      path: 'M12 22 h4 M20 22 h1 M25 22 h3'
    },
    {
      id: 'angry',
      label: 'Angry',
      colour: '#AC5340',
      // two hard strokes pressing inward
      path: 'M12 25 Q20 19 28 25 M13 15 L18 18 M27 15 L22 18'
    }
  ];

  var BY_ID = {};
  MOODS.forEach(function (m) { BY_ID[m.id] = m; });

  /* Returns the SVG markup for one mood at a given pixel size.
     Falls back to a plain neutral disc when the mood is unknown or
     absent, so a conversation started before this existed still
     renders something sensible in the console. */
  function avatarSVG(moodId, size) {
    var m = BY_ID[moodId];
    var px = size || 40;

    if (!m) {
      return '<svg class="avatar-svg" viewBox="0 0 40 40" width="' + px + '" height="' + px + '" aria-hidden="true">' +
             '<circle cx="20" cy="20" r="19" fill="#E3DCD2"/>' +
             '<path d="M12 22 H28" fill="none" stroke="#8B8B8B" stroke-width="2" stroke-linecap="round"/>' +
             '</svg>';
    }

    return '<svg class="avatar-svg" viewBox="0 0 40 40" width="' + px + '" height="' + px + '" aria-hidden="true">' +
           '<circle cx="20" cy="20" r="19" fill="' + m.colour + '"/>' +
           '<path d="' + m.path + '" fill="none" stroke="#FCF6F0" stroke-width="2.1" ' +
           'stroke-linecap="round" stroke-linejoin="round"/>' +
           '</svg>';
  }

  function moodLabel(moodId) {
    return BY_ID[moodId] ? BY_ID[moodId].label : null;
  }

  window.BRINA_MOODS = {
    list: MOODS,
    byId: BY_ID,
    svg: avatarSVG,
    label: moodLabel
  };
}());
