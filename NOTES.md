# Notes del projecte — Diari Pauete i Mariuxi

> Aquest repositori és públic: aquí no hi ha correus, identificadors de documents ni contingut del diari.

Resum de com està muntat, què queda per fer i què hem après (10 d'octubre de 2026).

## Què és

Web-app per convertir el diari familiar que la Nidia escrivia al Google Docs «Diario de los papis» (amb una pestanya per any, 2022…) en un llibre de fotos A4 per imprimir, i per continuar escrivint-lo des d'ara a l'app.

- **App:** https://rogerbeltranps-lab.github.io/diari-pauete-maruxi/ (GitHub Pages, branca `main`, arrel).
- **Codi:** `index.html`, `app.js`, `style.css`, `config.js`, `manifest.webmanifest`, icones.
- **Contingut (privat):** Google Drive de Roger → carpeta **Diari Pauete i Mariuxi**:
  - `diari.json` — tots els textos, l'ordre, la portada, què s'ha importat i l'historial d'impressions. **No esborrar.**
  - `fotos/` — fotos reduïdes (1800 px) que fa servir el llibre. **No esborrar.**
  - `fotos-originals/` — fotos copiades del Google Docs per l'script. Només serveixen per importar; es poden esborrar quan tot estigui importat i revisat.
- **Google Docs original:** el de la Nidia, amb pestanyes per any (l'app només el llegeix, no el modifica mai).

## Google Cloud

- Projecte **Diari** al compte de Google de Roger.
- APIs activades: **Google Drive API** i **Google Docs API** (gratuïtes; sense compte de facturació).
- Pantalla de consentiment: Externa, mode **Prova**. Usuaris de prova: Roger i la Nidia. Per afegir algú més cal posar-lo aquí.
- Client OAuth web «Diari»: origen `https://rogerbeltranps-lab.github.io`, redirecció `https://rogerbeltranps-lab.github.io/diari-pauete-maruxi/`. L'ID és a `config.js`.
- Avís: des del 13/10/2026 Google Cloud demana verificació en dos passos per entrar a la consola (només per canviar configuració; l'app no ho necessita).

## Com funciona l'app

- Login amb Google (flux OAuth per redirecció, permís de Drive). Avís «app no verificada» → Continua: és normal en mode prova.
- Cada canvi llegeix el `diari.json` més recent, aplica el canvi i el torna a desar, perquè dues persones puguin escriure sense trepitjar-se.
- **Importa del Google Docs:** llegeix el document amb la Docs API (totes les pestanyes). Cada pestanya → capítol; cada línia curta amb data → entrada nova. Desa cada 4 dies i recorda on es va quedar (`meta.importProgress`), així que si es tanca a mitges continua. Una pestanya ja importada es pot tornar a marcar per reimportar-la (substitueix les seves entrades, camp `src`).
- **Imprimir:** tria «el que encara no s'ha imprès», per capítols o entre dates; després pregunta si s'ha imprès/desat i ho apunta a `meta.prints`. A Chrome: A4, marges Cap, Gràfics de fons, «Desa com a PDF».
- **Més…:** compartir el diari, actualitzar, portada, instal·lar al mòbil, buidar el diari i tornar a començar, sortir.

## Problemes que vam trobar i com es van resoldre

1. **«Failed to fetch» i importació que tornava a començar:** desava per pestanya sencera → ara desa cada 4 dies, reintenta errors de xarxa i salta fotos que fallen.
2. **El llibre sortia sense fotos:** el navegador no pot descarregar les fotos d'un Google Docs (CORS). Solució: script de Google **`copiar-fotos.gs`** (projecte Apps Script **copiarFotos**) que les copia a `fotos-originals/` amb el nom `tabId__objectId.img`; l'app les agafa d'allà en importar.
   - L'script necessita el servei avançat **Google Docs API** (Serveis → +).
   - Copia ~140 fotos cada tanda de ~4,5 min i es torna a programar sol cada minut fins que diu **FET**. El document té ~2.300 fotos (~1 h 30 min).
   - Límit gratuït: ~90 min/dia d'execucions automàtiques. Si s'atura per quota, l'endemà prémer ▷ Run i continua.

## Estat (10/10/2026, 22:35)

- [x] App publicada i connectada a Google.
- [x] Carpeta del diari creada al Drive de Roger.
- [ ] L'script copiarFotos està copiant les fotos (començat 21:39). Comprovar a Executions que acabi amb **FET**.
- [ ] A l'app: **Més… → Buida el diari** (la primera importació del 2022 no tenia fotos) i després **Importa del Google Docs** amb totes les pestanyes.
- [ ] Revisar el llibre: dies units/partits malament → Edita → «Uneix amb l'anterior» o dir-ho a Claude per ajustar la detecció de dates.
- [ ] Compartir el diari amb la Nidia: **Més… → Comparteix** → correu de la Nidia. Que ella entri i l'afegeixi a la pantalla d'inici.
- [ ] A partir d'aquí, la Nidia escriu només a l'app (no al Google Docs).
- [ ] Quan tot estigui revisat: es pot esborrar `fotos-originals/` i el projecte Apps Script copiarFotos.

## Altres coses del compte de Roger (no tocar)

- Projecte Apps Script **«Mar & Pau's Crew sync - NO ESBORRAR»** (abans «Untitled project», 5/10/2026): sincronitza el full de càlcul del cangur amb l'app Mar & Pau's Crew cada 30 minuts. Roger vol que només s'executi els divendres; pendent de revisar com el va configurar abans de canviar-lo.

## Actualització (11/10/2026)

- Importació completa: 7 pestanyes (2022–2026, «Fotos Papis», «Fotos PAU i MAR»), 1.006 entrades, 2.320 fotos. Revisat contra el Google Docs: tot el text hi és; només falten 3 imatges de menys de 90 px (icones/adhesius) del 6/02/2026, que l'app descarta a propòsit.
- Corregits a mà: 3 falsos capítols (postal de Nadal 2025, «1011/09/2026», «10/2026») i 2 frases amb data que havien partit una entrada (14/05/2022 i 3/07/2026). La detecció ja ho evita en futures importacions.
- Al document original hi ha ~40 dates amb l'any que no toca el capítol (p. ex. 2024 amb dates «/2025» de setembre a desembre). Pendent que Roger decideixi si es corregeixen a l'app.
- Noves funcions: botó «Fotos» per entrada (mida, nombre, retall, posició, ordre), «Colors del llibre» (Clàssic, Blau cel, Blau marí), «Còpia de seguretat» (carpeta + Google Docs dins la carpeta del diari) i importació que continua sola si Google demana tornar a entrar.

- 11/10/2026: comparades les dues versions; Roger es queda amb «Diaris Nidia» (llibre obert, diversos diaris), que ja inclou la còpia de seguretat, el botó Fotos, la impressió amb historial i la importació que continua sola. La importació s'ha tret del menú.
