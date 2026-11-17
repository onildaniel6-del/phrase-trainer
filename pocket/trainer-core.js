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
    // streak - верных подряд: по нему «Подход» считает «выучено» (порог «легко / трудно» бывает выше 5-й коробки)
    var run = typeof s.streak === 'number' ? s.streak : s.box
    s.seen += 1
    s.last = day
    if (grade === 'wrong') {
      s.wrong += 1
      s.box = 1
      s.streak = 0
      s.due = day // вернётся сегодня в конце очереди и завтра снова
      return s
    }
    s.correct += 1
    if (grade === 'hard') {
      s.box = Math.max(1, s.box)
      s.streak = run
      s.due = addDays(day, 1)
      return s
    }
    s.streak = run + 1
    s.box = Math.min(MAX_BOX, s.box + 1)
    s.due = addDays(day, INTERVALS[s.box])
    return s
  }

  // ★ Приоритет (словарь «Подхода», поиск глоссария): невыученное с приоритетом - первым в очереди
  function isTop(p) {
    return !!(p && p.priority && p.status !== 'learned' && p.status !== 'excluded' && !p.learnedAt)
  }
  function topFirst(list, progress) {
    return list.filter(function (c) { return isTop(progress[c.id]) }).concat(list.filter(function (c) { return !isTop(progress[c.id]) }))
  }

  // Очередь на сессию: сначала просроченные (меньшая коробка раньше), потом новые в пределах дневного лимита.
  // Исключённые («✕» в словаре «Подхода», «Не нужно» в глоссарии) - никогда; ★ приоритетные - первыми в своей группе,
  // а приоритетные повторения - впереди всего.
  function buildQueue(cards, progress, day, newLimit, newSeenToday) {
    var due = []
    var fresh = []
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i]
      var p = progress[c.id]
      if (p && p.status === 'excluded') continue
      if (!p || p.seen === 0) fresh.push(c)
      else if (p.due <= day) due.push(c)
    }
    due.sort(function (a, b) {
      var pa = progress[a.id]
      var pb = progress[b.id]
      return pa.box - pb.box || (pa.due < pb.due ? -1 : pa.due > pb.due ? 1 : 0)
    })
    var room = Math.max(0, newLimit - newSeenToday)
    due = topFirst(due, progress)
    var topDue = due.filter(function (c) { return isTop(progress[c.id]) })
    var newOnes = topFirst(fresh, progress).slice(0, room)
    var topNew = newOnes.filter(function (c) { return isTop(progress[c.id]) })
    return topDue.concat(topNew, due.slice(topDue.length), newOnes.slice(topNew.length))
  }

  // ★ / ☆: снятие хранится как priority:false с временем (слияние телефон <-> ПК - побеждает позднее)
  function setPriority(p, on, nowIso) {
    return Object.assign(emptyProgress(), p, { priority: !!on, priorityAt: nowIso || new Date().toISOString() })
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

  // ---------- Глоссарий (страница public/glossary-offline) ----------
  var LEARNED_BOX = 4 // интервал от 7 дней и верный ответ — «выучено»

  // new | learning | learned | excluded
  function glossaryStatus(p) {
    if (!p) return 'new'
    if (p.status === 'excluded') return 'excluded'
    if (p.status === 'learned' || p.box >= LEARNED_BOX) return 'learned'
    return p.seen > 0 ? 'learning' : 'new'
  }

  // Режим по коробке: узнать -> выбрать/вписать -> на слух -> вспомнить по-русски.
  function chooseGlossaryMode(card, box) {
    var hasCloze = card.cloze && card.cloze !== '_____'
    var hasChoice = card.distractors && card.distractors.length >= 2
    if (box <= 0) return 'recognize'
    if (box === 1) return hasChoice ? 'choice' : hasCloze ? 'type' : 'recall'
    if (box === 2) return hasCloze ? 'listen' : 'recall'
    return 'recall'
  }

  function applyGrade(p, grade, day) {
    var s = nextState(p, grade, day)
    if (p && p.status === 'excluded') s.status = 'excluded'
    else if (s.box >= LEARNED_BOX) {
      s.status = 'learned'
      if (!s.learnedAt) s.learnedAt = day
    } else s.status = 'learning'
    return s
  }

  // «Знаю» — уже знаю по работе: сразу выучено, вернётся через 14 дней для проверки
  function markKnown(p, day) {
    var s = Object.assign(emptyProgress(), p)
    s.status = 'learned'
    s.manual = true
    s.seen = Math.max(1, s.seen) // иначе очередь считает карточку новой и не вернёт её на проверку
    s.box = MAX_BOX
    s.due = addDays(day, INTERVALS[MAX_BOX])
    s.learnedAt = s.learnedAt || day
    return s
  }

  function markExcluded(p) {
    return Object.assign(emptyProgress(), p, { status: 'excluded' })
  }

  function backToLearning(p, day) {
    var s = Object.assign(emptyProgress(), p)
    s.status = 'learning'
    s.manual = false
    s.box = 1
    s.streak = 0
    s.due = day
    delete s.learnedAt
    return s
  }

  var api = {
    INTERVALS: INTERVALS,
    LEARNED_BOX: LEARNED_BOX,
    glossaryStatus: glossaryStatus,
    chooseGlossaryMode: chooseGlossaryMode,
    applyGrade: applyGrade,
    markKnown: markKnown,
    markExcluded: markExcluded,
    backToLearning: backToLearning,
    today: today,
    addDays: addDays,
    nextState: nextState,
    buildQueue: buildQueue,
    setPriority: setPriority,
    isTop: isTop,
    chooseMode: chooseMode,
    normalize: normalize,
    checkAnswer: checkAnswer,
    shuffle: shuffle,
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.TrainerCore = api
})(typeof window !== 'undefined' ? window : globalThis)
