# Спрайты

Интерьер, модули, грузы и пешки рисуются с листов Kenney (CC0, kenney.nl):

- `kenney/tiles.png` — полы, стены, двери, мебель, грузы
- `kenney/chars.png` — тела, одежда и волосы пешек
- `kenney/indoor.png` — мостик

Если лист не загрузился, клетка рисуется процедурно.

Отдельный PNG `public/sprites/<тип>.png` (64×64) по-прежнему заменяет картинку одного модуля.
Имена: bridge, reactor, battery, engine, o2gen, water_recycler, hydroponics, bed, medbay,
shield_gen, laser, missile, radar, mining_laser, lamp, solar_panel, cryopod, vent.
