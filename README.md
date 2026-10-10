# Diari Pauete i Mariuxi

Web-app per convertir el diari familiar en un llibre de fotos per imprimir.

- **On és l'app:** https://rogerbeltranps-lab.github.io/diari-pauete-maruxi/
- **On es guarda el contingut:** a la carpeta «Diari Pauete i Mariuxi» del Google Drive (un arxiu `diari.json` amb els textos i una carpeta `fotos`). Res del diari es guarda en aquest repositori.

## Configuració (una sola vegada, uns 15 minuts)

Cal crear un «ID de client» de Google perquè l'app pugui fer login i guardar al Drive.

1. Entra a https://console.cloud.google.com amb el teu compte de Google.
2. **Crea un projecte**: a dalt, al selector de projectes → *Projecte nou* → nom `Diari` → *Crea*.
3. **Activa l'API de Drive**: menú → *APIs i serveis* → *Biblioteca* → cerca **Google Drive API** → *Activa*.
4. **Pantalla de consentiment** (a *APIs i serveis* → *Pantalla de consentiment d'OAuth*, o *Google Auth Platform*):
   - Tipus d'usuari: **Extern**.
   - Nom de l'app: `Diari Pauete i Mariuxi`, i el teu correu on ho demani.
   - A **Públic / Usuaris de prova**, afegeix el teu correu i el de la Nidia.
   - Deixa l'app en mode **Prova** (no cal publicar-la ni verificar-la).
5. **Crea el client**: *Credencials* (o *Clients*) → *Crea credencials* → **ID de client d'OAuth**:
   - Tipus d'aplicació: **Aplicació web**.
   - **Orígens de JavaScript autoritzats:** `https://rogerbeltranps-lab.github.io`
   - **URI de redirecció autoritzats:** `https://rogerbeltranps-lab.github.io/diari-pauete-maruxi/`
   - *Crea* i copia l'**ID de client** (acaba en `.apps.googleusercontent.com`).
6. Posa'l a `config.js`, a `clientId: '...'` (es pot editar des de la web de GitHub amb el llapis), o passa-li a Claude perquè ho faci.

## Primer ús

1. Obre l'app i entra amb Google. Com que l'app està en mode prova, Google mostrarà l'avís «Google no ha verificat aquesta aplicació»: prem **Continua**. És normal per a una app privada.
2. Prem **Crea el diari**. Es crea la carpeta al teu Drive.
3. **Més… → Comparteix el diari amb algú** i posa el correu de la Nidia.
4. **Més… → Importa del Google Docs**: al Google Docs, des de l'ordinador, *Fitxer → Baixa → Microsoft Word (.docx)* i tria **Totes les pestanyes** (o baixa cada pestanya i puja-les juntes).

## Com detecta les entrades del .docx

- Una línia curta amb un any (per exemple «DIARIO DE LOS PAPIS 2022») → **capítol**.
- Una línia curta amb una data («15 de marzo», «12/05/2022», «Sábado…») → **entrada nova**.
- Tot el text i les fotos que hi ha fins a la següent data → aquella entrada.

Si una entrada surt partida, a l'app: *Edita → Uneix amb l'anterior*.

## Imprimir

Botó **Imprimir** → A4, marges *Cap*, *Gràfics de fons* activat. Per imprimir només un any, tria'l al menú de dalt abans.
