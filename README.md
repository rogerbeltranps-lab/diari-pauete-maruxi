# Diari Pauete i Mariuxi

Web-app per convertir el diari familiar en un llibre de fotos per imprimir.

- **On és l'app:** https://rogerbeltranps-lab.github.io/diari-pauete-maruxi/
- **On es guarda el contingut:** a la carpeta «Diari Pauete i Mariuxi» del Google Drive (un arxiu `diari.json` amb els textos i una carpeta `fotos`). Res del diari es guarda en aquest repositori.

## Configuració (una sola vegada, uns 15 minuts)

Cal crear un «ID de client» de Google perquè l'app pugui fer login i guardar al Drive.

1. Entra a https://console.cloud.google.com amb el teu compte de Google.
2. **Crea un projecte**: a dalt, al selector de projectes → *Projecte nou* → nom `Diari` → *Crea*.
3. **Activa dues APIs**: menú → *APIs i serveis* → *Biblioteca* → cerca **Google Drive API** → *Activa*. Després cerca **Google Docs API** → *Activa* (serveix per llegir el diari directament del Google Docs).
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
4. **Més… → Importa del Google Docs**: tria el document del diari i les pestanyes. L'app el llegeix directament (no cal baixar-lo) i copia les fotos a la carpeta del diari. Ho ha de fer algú que tingui accés al document. Amb moltes fotos pot trigar uns minuts: deixa la pantalla oberta. Si cal parar, les pestanyes ja importades surten desmarcades la vegada següent.

## Fotos del Google Docs (pas previ)

El navegador no pot copiar les fotos d'un Google Docs. Per això hi ha un petit script de Google, `copiar-fotos.gs`, que les copia a «Diari Pauete i Mariuxi / fotos-originals». A l'app, *Importa del Google Docs* et mostra quantes fotos estan preparades i un botó **Copia el script** (ja porta l'identificador del document). Enganxa'l a https://script.google.com (projecte nou), desa i executa `copiarFotos`. Si hi ha moltes fotos, continua sol cada minut fins que al registre surt **FET**.

## Com detecta les entrades

- Cada pestanya del document → **capítol** (el títol serà, per exemple, «DIARIO DE LOS PAPIS 2022» si la pestanya comença amb aquesta línia).
- Una línia curta amb un any → també **capítol**.
- Una línia curta amb una data («15 de marzo», «12/05/2022», «Sábado…») → **entrada nova**.
- Tot el text i les fotos que hi ha fins a la següent data → aquella entrada.

Si una entrada surt partida, a l'app: *Edita → Uneix amb l'anterior*.

## Imprimir

Botó **Imprimir** → A4, marges *Cap*, *Gràfics de fons* activat. Per imprimir només un any, tria'l al menú de dalt abans.

També es pot importar un arxiu .docx (Més… → Importa del Google Docs → Puja un .docx), però amb documents grans és millor la lectura directa.
