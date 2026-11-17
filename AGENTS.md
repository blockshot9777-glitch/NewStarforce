# Инструкции для ИИ-ассистента (Cursor / Claude Code)

Ты продолжаешь разработку **StarForce** — «RimWorld в космосе» с онлайном. Прочитай перед работой:
`README.md`, `docs/GDD.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`.
**Любая работа с графикой — только по `docs/ART_STYLE.md` и референсам в `docs/art-reference/`.**

## Золотые правила проекта

1. **Сервер авторитарен.** Любая игровая логика — только в `packages/shared/src`. Клиент рисует и шлёт
   `Command`, ничего не считает сам (кроме подсказок интерфейса, например `validateBuild` для превью).
2. **Состояние — простые данные.** В `WorldState` нельзя класть классы, функции, `Map`/`Set`: мир
   сохраняется через `JSON.stringify`. Кэши держи в `WeakMap` вне состояния (пример: `shipRooms` в `ship.ts`).
3. **Детерминизм.** Никаких `Math.random()` и `Date.now()` в `shared` — только `ctx.rng` / `this.rng`.
   Тест «мир из JSON продолжает жить точно так же» должен оставаться зелёным.
4. **Баланс — в `defs.ts`.** Числа не разбрасывать по логике.
5. **Любая команда клиента валидируется** в `World.command` (типы, границы, целые числа). Добавил команду —
   добавь её в `protocol.ts`, в `World.command`, в тест «мусорные команды не роняют сервер».
6. **Новый объект в снимке** → тип в `protocol.ts` → заполнение в `World.snapshotFor` → отрисовка в клиенте.
   В снимок идёт только то, что игрок видит (радиус сенсоров).
7. **Тексты игры — на русском**, комментарии в коде — на русском, как в существующих файлах.
8. **Проверяй фактически, а не на глаз:** после изменений всегда `npm run typecheck && npm test`,
   для клиента — `npm run build` и запуск игры. Не объявляй задачу сделанной, пока тесты не зелёные.
   Новая механика = новый тест в `packages/shared/test/`.

9. **Графика — тёмный индустриальный sci-fi, вид сверху, рисованные текстуры.** Никакого пиксель-арта,
   песочных/светлых полов, дерева, наковален, каминов и мультяшности. Не скачивай и не подключай
   сторонние ассеты сам: сначала опиши владельцу, что и откуда (с лицензией), и покажи скриншот в игре.
   Подробности и палитра — `docs/ART_STYLE.md`.

10. **Задача сделана = коммит отправлен.** `git pull` перед работой, `git push` после,
   проверить `git log origin/<ветка> --oneline -3`. Не ссылайся на коммиты, которых нет в origin;
   если задача уже сделана — покажи файл и функцию, а не только хэш.

## Команды

```bash
npm install
npm run dev        # сервер :8787 + клиент :5173 (горячая перезагрузка)
npm test           # vitest: shared + server
npm run typecheck
npm start          # сборка клиента + сервер на :8787
```

## Как устроено (кратко)

- `packages/shared/src/defs.ts` — баланс и данные; `ship.ts` — системы корабля; `crew.ts` — ИИ экипажа;
  `air.ts` — комнаты и воздух; `world.ts` — мир, бой, торговля, экспедиции, снимки.
- `packages/server/src/server.ts` — WebSocket `/ws`, цикл 10 тиков/с, сохранение в `data/world.json`.
- `packages/client/src/` — `main.ts` (ввод, цикл), `store.ts` (состояние клиента), `net.ts`, `ui.ts`
  (HTML-панели), `render/space.ts` (космос), `render/ship.ts` (интерьер), `render/modules.ts` (модули).
- Координаты: клетка корабля = `TILE_WORLD` (8) единиц космоса; центр корабля = `(ship.x, ship.y)`;
  `tileWorld()` / `worldToTile()` переводят туда и обратно.

## Как добавить модуль (пример рецепта)

1. `defs.ts`: добавить тип в `ModuleType` и запись в `MODULES` (стоимость, энергия, категория, глиф, цвет).
2. Логика: в `lifeSupport` (`ship.ts`) или в `World.updateShip` (`world.ts`).
3. Рисунок: ветка в `drawProcedural` (`render/modules.ts`) или PNG в `public/sprites/<тип>.png`.
4. Тест в `packages/shared/test/ship.test.ts`.
5. `npm run typecheck && npm test`.

## План работ — следующие задачи по порядку

Бери сверху, одна задача = один коммит с тестом. Коммит сразу пушить в текущую ветку,
не ждать отдельной просьбы.

1. **Швы на фоне — сделано.** `makeNebula` в `packages/client/src/render/space.ts`.
2. **Приоритеты работ — сделано.** Поле `Crew.priorities` в `state.ts`; выбор задачи `jobRank` в `crew.ts`;
   команда `setPriority` в `crew.ts` и `World.command` (`world.ts`); таблица `renderCrew` в `ui.ts`.
3. **Склады и переноска — сделано.** Стопки и доставка: `syncStored`, `planHaulJobs`, `stepHaul` в `items.ts`;
   команда `stockpile` в `World.command` (`world.ts`).
4. **Многоклеточные модули — сделано.** Размер `moduleSize` в `defs.ts`; проверка и занятость `validateBuild`
   в `ship.ts`; след модулей в `drawInterior` (`render/ship.ts`) и `drawModule` (`render/modules.ts`).
5. **Вентиляция — сделано.** `lifeSupport` в `ship.ts` собирает пары комнат у решётки, `stepAir` в `air.ts`
   переносит воздух при закрытой двери. Сети труб по клеткам и насосной станции в коде нет.
6. **Температура — сделано.** `stepTemp` в `temp.ts`; обогреватель и охладитель греют комнату в `lifeSupport`
   (`ship.ts`); урон в `updateCrew` (`crew.ts`); оверлей `drawTempLabels` в `render/ship.ts`.
6a. **Предупреждения и баланс воды — сделано.** `shipAlerts` и `trackRates` в `alerts.ts` (прогноз
   «вода/еда кончится через N мин», воздух, пробоины, пожары, энергия, пилот, корпус, раненые);
   поле `alerts` в `OwnShipView`; столбик `renderAlerts` в `ui.ts`. Баланс воды в `defs.ts`
   (`O2_GEN_WATER`, `HYDRO_WATER`, стартовый лёд): тест «стартовый корабль … живёт не меньше 30 минут»
   в `alerts.test.ts` — менять баланс только так, чтобы он оставался зелёным.
7. **Поверхность планет — сделано.** Генерация карты, ИИ команды и хищников — `surface.ts`
   (`generateSurface`, `stepSurface`, `orderSurfaceMove`, `toggleSurfaceMark`); данные биомов и существ —
   `SURFACE_BIOMES`, `CREATURES` в `defs.ts`; команды `expedition`/`recall`/`landMove`/`landMark` в
   `World.command`; отрисовка — `render/planet.ts`, режим `planet` в `main.ts`/`ui.ts`. Нужды экипажа на
   планете пока заморожены (еда/сон не тратятся) — это упрощение, а не ошибка. Тесты — `surface.test.ts`.
8. **События в космосе — сделано.** Сигналы (обломки, бедствие, торговец, аномалия): данные и баланс — `SIGNALS`
   и `SIGNAL_*` в `defs.ts`; появление, показ и розыгрыш исхода — `spawnSignal`, `signalEvent`, `resolveSignal`
   в `world.ts`; команда `signal`; поле `event` в `OwnShipView`, контакт `signal`; карточка — `eventCard` в `ui.ts`,
   маяк и стрелка у края экрана — `drawSignal` в `render/space.ts`. Тесты — `signals.test.ts`.
   **Новое событие = новая запись в `SIGNALS`** (текст, варианты, исходы с весами) — код менять не нужно.
9. **Настроение и черты характера — сделано.** `mood.ts`: мысли `crewThoughts`, цель `moodTarget`, шаг и срыв
   `stepMood`, миграция `normalizeMind`; данные и баланс — `TRAITS`, `THOUGHTS`, `MOOD_*` в `defs.ts`; влияние на
   работу и ходьбу — `workSpeed`/`moveAlong` в `crew.ts`; поля `mood/trait/thoughts/breakdown` в `CrewView`;
   тревоги `break:`/`mood:` в `alerts.ts`; показ — `renderCrew`, `pawnCard`, `renderTooltip` в `ui.ts`.
   Тесты — `mood.test.ts`. **Новая мысль или черта = запись в `THOUGHTS`/`TRAITS`** (+ условие в `crewThoughts`).
10. **Прицельный огонь — сделано.** Прицел `Ship.aim` (корпус/оружие/двигатели/щиты), команда `aim`; системы
    врага `Npc.sub` и их починка — `npcSub`, `damageNpc`, `updateNpcs` в `world.ts`; по кораблям игроков прицел
    бьёт в модули (`AIM_MODULES`, `damageShip`); баланс — `AIM_*`, `NPC_SUB_*` в `defs.ts`; в снимке — `aim` и
    `sub` у контакта `npc`; выбор — `aimPanel` в `ui.ts`, клавиши 1–4, метки систем — `drawNpc`. Тесты — `aim.test.ts`.
11. Далее — `docs/ROADMAP.md`, фазы 3–4.

## Арт

- **Процедурные ассеты** — `packages/client/src/render/gen/`: `kit.ts` (шум, освещённые карты высот, фаски,
  кэш), `hull.ts` (корпус из планировки), `space.ts` (астероиды, планеты, станция, враги, контейнеры),
  `surface.ts` (шаттл и существа). Всё освещено сверху-слева, рисуется один раз и кэшируется.
- **Галерея**: откройте игру с `?gallery=1` — все процедурные спрайты крупно, плюс замер времени генерации
  в консоли (`timing: …`). Любую правку арта проверяйте там и скриншотом в игре.
- **Корпус генерируется в фоновом потоке** (`hullWorker.ts`, `hullStore.ts`): стройка не подвешивает игру,
  пока рисуется новый корпус — показывается прежний. Не переносите генерацию обратно в главный поток.
- **Рельеф планеты** (`render/terrain.ts`) тоже считается в фоне (`terrainWorker.ts`, `terrainImage` в
  `render/planet.ts`) и заранее, как только пришла карта высадки. Один биом крупно: `?gallery=1&biome=volcanic`
  (в консоли — `timing: terrain …`).
- **Постобработка** — `render/post.ts` (WebGL поверх 2D-холста): свечение ярких источников, тональная кривая,
  цветокоррекция, виньетка, зерно. Не включается на программном WebGL и сама выключается, если кадр дольше
  ~28 мс. `?post=0` — выключить, `?post=1` — включить принудительно (скриншоты в headless-браузере).
- **Свет интерьера** — `drawLighting` в `render/ship.ts`: цветные источники (`LIGHT_COLOR`), свет обрезан
  комнатой (сквозь стены не проходит), пожары мерцают, разгерметизация — красная тревога.
- **Живые детали (только визуал клиента):** свечение модулей — таблица `GLOW` в `render/modules.ts`;
  двери и походка — `paintDoorSliding`, `crewWalk` в `render/ship.ts`; тени облаков и частицы по биому —
  `drawAtmosphere` в `render/planet.ts`; гиперпрыжок — `drawJump` в `render/space.ts`; свет звезды на объектах —
  `render/sunlight.ts`; рисованная туманность — `nebulaPixels` (`render/nebula.ts`, считается в `nebulaWorker.ts`).
- **Звук** — `packages/client/src/audio.ts`: синтез WebAudio без файлов (фон, двигатель, бур, бой, взрывы,
  тревоги, прыжок, кнопки); громкость/панорама — `spatial` (тест `packages/client/test/audio.test.ts`); M — без звука.
- **Отдача и читаемость (идеи FTL, Cosmoteer, RimWorld):** числа урона и встряска — `floaters`/`shake` в
  `store.ts`, рисование в `drawFx`/`drawHurt`; турели — `drawTurrets` (`render/space.ts`); значки занятий —
  `drawCrewBubble` (`render/ship.ts`); подсказка под курсором — `renderTooltip` (`ui.ts`); карточка стройки —
  `drawToolPreview` (`main.ts`).
- **Интерфейс** — стекло, уголки-скобы, полоски с бликом: блок «Современный вид интерфейса» в конце `style.css`.
- Готовые PNG важнее процедурных: недостающие спрайты и промты — `docs/ASSETS_NEEDED.md`; спрайты
  грузятся через `render/painted.ts` (`drawPaintedSprite`). Рельеф планет — `render/terrain.ts`.

## Чего не делать

- Не переносить логику в клиент «для скорости».
- Не добавлять тяжёлые зависимости без необходимости (рендер — Canvas 2D; для WebGL позже — PixiJS).
- Не ломать протокол без увеличения `PROTOCOL_VERSION`.
- Не отключать и не ослаблять тесты, чтобы «стало зелёным».
