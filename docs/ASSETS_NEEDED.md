# Каких спрайтов не хватает

Игра уже умеет их загружать: положите PNG по указанному пути — он заменит процедурную отрисовку
без правки кода. Пока файла нет, рисуется замена кодом.

**Стиль** — как у существующих спрайтов (`sprites/pawns`, `sprites/items`, модули): тёмный индустриальный
sci-fi, вид строго сверху, рисованные полуреалистичные текстуры, свет сверху-слева. См. `docs/ART_STYLE.md`.

**Как получить файл** (так же сделаны существующие, см. `CREDITS.md`):
1. Сгенерировать картинку по промту ниже (любой генератор изображений: Midjourney, DALL·E, Flux…),
   квадрат, фон — ровный пурпурный `#FF00FF` (хромакей).
2. Прогнать `scripts/pack-sprites.ps1`: уменьшение до 128×128 и вырезание пурпурного фона.
3. Положить по пути из таблицы и дописать строку в `CREDITS.md` (инструмент, дата, промт).

Общий хвост промта (добавлять к каждому): *Painted semi-realistic, soft light from top-left, seen from
directly above. Centered with margin. Background is a perfectly flat solid chroma-key magenta #FF00FF
with no gradient, no shadow, no floor. No text, no pixel art, no cartoon.*

## Поверхность планет

| Файл | Промт |
|---|---|
| `sprites/planet/shuttle.png` | Top-down orthographic game sprite of a small landed spaceship shuttle, light grey weathered hull with a red stripe, cockpit glass with a cyan glow, four landing legs, small red landing lights, scorch marks. |
| `sprites/planet/vine.png` | Top-down game sprite of a carnivorous alien vine creature: a coiled thorny dark-green stalk with a purple venus-flytrap mouth in the center, glowing yellow spots. |
| `sprites/planet/stalker.png` | Top-down game sprite of a grove stalker: a lean six-legged alien predator made of bark and moss, dark green, glowing yellow eyes, seen from above. |
| `sprites/planet/sporeling.png` | Top-down game sprite of a sporeling: a round mushroom-like alien creature with a yellow-green spotted cap and short tendrils, faint glowing spores. |
| `sprites/planet/drone_scout.png` | Top-down orthographic game sprite of a hostile machine sentry drone: dark gunmetal quadcopter frame, four rotors, a single red glowing eye in the center. |
| `sprites/planet/ice_crawler.png` | Top-down game sprite of an ice crawler: a segmented pale blue arthropod with frosty translucent plates and eight short legs. |
| `sprites/planet/magma_beetle.png` | Top-down game sprite of a magma beetle: a heavy black basalt-shelled beetle with glowing orange cracks between its armor plates. |
| `sprites/planet/beast.png` | Top-down game sprite of a local four-legged alien grazer beast, brown-grey hide, small horns, seen from directly above. |

## Следующими (движок пока рисует их кодом, крючков загрузки ещё нет)

- Корпуса кораблей вокруг интерьера (скаут, фрегат, крейсер) — как «Буран» на скринах 2017 года.
- Враги в космосе: дрон-охотник, Страж Машин, Спорокаст.
- Станция, астероиды, контейнеры с грузом.
