// Ядро офлайн-тренажёра фраз: Лейтнер, очередь, проверка ответа. Чистые функции, без DOM.
// Обычный скрипт (не ES-модуль): так страница работает и с диска (file://), где модули блокируются.
// В браузере -> window.TrainerCore, в тестах -> module.exports.
;(function (root) {
  'use strict'

  // Интервал (дней) до следующего показа при попадании в коробку N. 0 — новая.
  var INTERVALS = [0, 1, 2, 4, 7, 14]
  var MAX_BOX = 5

  function pad(n) {
    return (n < 10 ? '0' : '') + n
  }

  function today(d) {
    d = d || new Date()
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function addDays(day, n) {
    var p = day.split('-')
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n)
    return today(d)
  }

  function emptyProgress() {
    return { box: 0, due: '', seen: 0, correct: 0, wrong: 0 }
  }

  // grade: 'wrong' | 'hard' | 'right'
  function nextState(p, grade, day) {
    var s = Object.assign(emptyProgress(), p)
    s.seen += 1
    s.last = day
    if (grade === 'wrong') {
      s.wrong += 1
      s.box = 1
      s.due = day // вернётся сегодня в конце очереди и завтра снова
      return s
    }
    s.correct += 1
    if (grade === 'hard') {
      s.box = Math.max(1, s.box)
      s.due = addDays(day, 1)
      return s
    }
    s.box = Math.min(MAX_BOX, s.box + 1)
    s.due = addDays(day, INTERVALS[s.box])
    return s
  }

  // Очередь на сессию: сначала просроченные (меньшая коробка раньше), потом новые в пределах дневного лимита.
  function buildQueue(cards, progress, day, newLimit, newSeenToday) {
    var due = []
    var fresh = []
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i]
      var p = progress[c.id]
      if (!p || p.seen === 0) fresh.push(c)
      else if (p.due <= day) due.push(c)
    }
    due.sort(function (a, b) {
      var pa = progress[a.id]
      var pb = progress[b.id]
      return pa.box - pb.box || (pa.due < pb.due ? -1 : pa.due > pb.due ? 1 : 0)
    })
    var room = Math.max(0, newLimit - newSeenToday)
    return due.concat(fresh.slice(0, room))
  }

  // Тип упражнения по коробке: выбор формы -> ввод -> вспомнить по смыслу.
  function chooseMode(card, box) {
    var hasChoice = card.distractors && card.distractors.length >= 2
    if (box <= 1 && hasChoice) return 'choice'
    if (box <= 3) return 'type'
    return 'recall'
  }

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function levenshtein(a, b) {
    if (a === b) return 0
    var prev = []
    for (var j = 0; j <= b.length; j++) prev[j] = j
    for (var i = 1; i <= a.length; i++) {
      var cur = [i]
      for (var k = 1; k <= b.length; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1))
      }
      prev = cur
    }
    return prev[b.length]
  }

  // 'exact' | 'typo' (опечатка — засчитываем, но показываем правильно) | 'wrong'
  function checkAnswer(answer, target) {
    var a = normalize(answer)
    var t = normalize(target)
    if (!a) return 'wrong'
    if (a === t) return 'exact'
    // Опечатка: не больше 1 правки на 12 символов. Неверный предлог/артикль — это ошибка, а не опечатка.
    var allowed = Math.max(1, Math.floor(t.length / 12))
    var aw = a.split(' ')
    var tw = t.split(' ')
    if (aw.length !== tw.length) return 'wrong'
    var SHORT = { a: 1, an: 1, the: 1, in: 1, on: 1, at: 1, for: 1, to: 1, of: 1, by: 1, with: 1, from: 1 }
    for (var i = 0; i < tw.length; i++) {
      if (aw[i] !== tw[i] && (SHORT[tw[i]] || SHORT[aw[i]])) return 'wrong'
    }
    return levenshtein(a, t) <= allowed ? 'typo' : 'wrong'
  }

  function shuffle(list, rand) {
    rand = rand || Math.random
    var a = list.slice()
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1))
      var t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    return a
  }

  var api = {
    INTERVALS: INTERVALS,
    today: today,
    addDays: addDays,
    nextState: nextState,
    buildQueue: buildQueue,
    chooseMode: chooseMode,
    normalize: normalize,
    checkAnswer: checkAnswer,
    shuffle: shuffle,
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.TrainerCore = api
})(typeof window !== 'undefined' ? window : globalThis)
