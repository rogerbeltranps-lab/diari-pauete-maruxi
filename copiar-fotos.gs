/**
 * Diari Pauete i Mariuxi — copia les fotos del Google Docs a la carpeta del diari.
 *
 * El navegador no pot copiar directament les fotos d'un Google Docs, però un
 * script de Google (Apps Script) sí. Aquest script les desa a
 * «Diari Pauete i Mariuxi / fotos-originals» i després l'app les fa servir.
 *
 * Com fer-lo servir:
 *  1. Ves a https://script.google.com i prem «Projecte nou».
 *  2. Esborra el que hi ha i enganxa tot aquest text.
 *  3. A DOC_ID posa l'identificador del document (l'app te'l dona ja posat).
 *  4. Prem Desa (icona del disquet) i després «Executa» amb la funció copiarFotos.
 *  5. Google et demanarà permisos: accepta'ls (és el teu propi script).
 *  6. Si hi ha moltes fotos, el script continua sol cada minut fins que acaba.
 *     Al «Registre d'execució» veuràs «FET» quan hagi acabat.
 */
const DOC_ID = 'ENGANXA_AQUI_L_ID_DEL_DOCUMENT';
const FOLDER_NAME = 'Diari Pauete i Mariuxi';

function copiarFotos() {
  const start = Date.now();
  DocumentApp.openById(DOC_ID); // comprova que tens accés al document
  const folder = carpetaFotos_();
  const existing = new Set();
  const files = folder.getFiles();
  while (files.hasNext()) existing.add(files.next().getName());

  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch('https://docs.googleapis.com/v1/documents/' + DOC_ID + '?includeTabsContent=true',
    { headers: { Authorization: 'Bearer ' + token } });
  const doc = JSON.parse(res.getContentText());
  const tabs = [];
  (function walk(ts) { (ts || []).forEach(function (t) { tabs.push(t); walk(t.childTabs); }); })(doc.tabs);

  let fetes = 0, pendents = 0, errors = 0;
  tabs.forEach(function (t) {
    const dt = t.documentTab || {};
    const tabId = t.tabProperties.tabId;
    const objs = [];
    Object.keys(dt.inlineObjects || {}).forEach(function (id) { objs.push([id, dt.inlineObjects[id].inlineObjectProperties]); });
    Object.keys(dt.positionedObjects || {}).forEach(function (id) { objs.push([id, dt.positionedObjects[id].positionedObjectProperties]); });
    objs.forEach(function (pair) {
      const name = tabId + '__' + pair[0] + '.img';
      if (existing.has(name)) return;
      const ip = pair[1] && pair[1].embeddedObject && pair[1].embeddedObject.imageProperties;
      const uri = ip && (ip.contentUri || ip.sourceUri);
      if (!uri) return;
      if (Date.now() - start > 4.5 * 60 * 1000) { pendents++; return; }
      try {
        const blob = UrlFetchApp.fetch(uri, { headers: { Authorization: 'Bearer ' + token } }).getBlob().setName(name);
        folder.createFile(blob);
        existing.add(name);
        fetes++;
      } catch (e) { errors++; console.warn(name + ': ' + e); }
    });
  });

  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'copiarFotos') ScriptApp.deleteTrigger(tr); });
  if (pendents) {
    ScriptApp.newTrigger('copiarFotos').timeBased().after(60 * 1000).create();
    console.log('Copiades ' + fetes + ' fotos ara. En falten ' + pendents + ': el script continuarà sol d\'aquí a 1 minut.');
  } else {
    console.log('FET. Fotos noves: ' + fetes + '. Total a la carpeta: ' + existing.size + '. Errors: ' + errors + '.');
  }
}

function carpetaFotos_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  if (!it.hasNext()) throw new Error('No trobo la carpeta «' + FOLDER_NAME + '». Obre l\'app i prem «Crea el diari» primer.');
  const diari = it.next();
  const sub = diari.getFoldersByName('fotos-originals');
  return sub.hasNext() ? sub.next() : diari.createFolder('fotos-originals');
}
