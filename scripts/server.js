import Promise from 'bluebird';
import browserify from 'browserify';
import budo from 'budo';
import fs from 'fs';
import glob from 'glob';
import mkdirp from 'mkdirp';
import sass from 'node-sass';
import path from 'path';
import vjslangs from 'videojs-languages';

/* eslint no-console: 0 */

const pkg = require(path.join(__dirname, '../package.json'));

// Replace "%s" tokens with the plugin name in a string.
const nameify = (str) =>
  str.replace(/%s/g, pkg.name.split('/').reverse()[0]);

const srces = {
  css: 'src/plugin.scss',
  js: 'src/plugin.js',
  langs: 'lang/*.json',
  tests: glob.sync('test/**/*.test.js')
};

const dests = {
  css: nameify('dist/%s.css'),
  js: nameify('dist/%s.js'),
  langs: 'dist/lang',
  tests: 'test/dist/bundle.js'
};

const bundlers = {

  js: browserify({
    debug: true,
    entries: [srces.js],
    standalone: nameify('%s'),
    transform: [
      'babelify',
      'browserify-shim',
      'browserify-versionify'
    ]
  }),

  tests: browserify({
    debug: true,
    entries: srces.tests,
    transform: [
      'babelify',
      'browserify-shim',
      'browserify-versionify'
    ]
  })
};

const bundle = (name) => {
  return new Promise((resolve, reject) => {
    bundlers[name]
      .bundle()
      .pipe(fs.createWriteStream(dests[name]))
      .on('finish', resolve)
      .on('error', reject);
  });
};

mkdirp.sync('dist');

// Start the server _after_ the initial bundling is done.
Promise.all([bundle('js'), bundle('tests')]).then(() => {
  const server = budo({
    port: 9999,
    stream: process.stdout
  }).on('reload', (f) => console.log('reloading %s', f || 'everything'));

  /**
   * A collection of functions which are mapped to strings that are used to
   * generate RegExp objects. If a filepath matches the RegExp, the function
   * will be used to handle that watched file.
   *
   * @type {Object}
   */
  const handlers = {

    /**
     * Handler for language JSON files.
     *
     * @param  {String} event
     * @param  {String} file
     */
    '^lang/.+\.json$'(event, file) {
      console.log('re-compiling languages');
      vjslangs(srces.langs, dests.langs);
      server.reload();
    },

    /**
     * Handler for Sass source.
     *
     * @param  {String} event
     * @param  {String} file
     */
    '^src/.+\.scss$'(event, file) {
      console.log('re-compiling sass');
      let result = sass.renderSync({file: srces.css, outputStyle: 'compressed'});

      fs.writeFileSync(dests.css, result.css);
      server.reload();
    },

    /**
     * Handler for JavaScript source.
     *
     * @param  {String} event
     * @param  {String} file
     */
    '^src/.+\.js$'(event, file) {
      console.log('re-bundling javascript and tests');
      Promise.all([bundle('js'), bundle('tests')]).then(() => server.reload());
    },

    /**
     * Handler for JavaScript tests.
     *
     * @param  {String} event
     * @param  {String} file
     */
    '^test/.+\.test\.js$'(event, file) {
      console.log('re-bundling tests');
      bundle('tests').then(() => server.reload());
    }
  };

  /**
   * Finds the first handler function for the file that matches a RegExp
   * derived from the keys.
   *
   * @param  {String} file
   * @return {Function|Undefined}
   */
  const findHandler = (file) => {
    const keys = Object.keys(handlers);

    for (let i = 0; i < keys.length; i++) {
      let regex = new RegExp(keys[i]);

      if (regex.test(file)) {
        return handlers[keys[i]];
      }
    }
  };

  server
    .live()
    .watch([
      'index.html',
      'lang/*.json',
      'src/**/*.{scss,js}',
      'test/**/*.test.js',
      'test/index.html'
    ])
    .on('watch', (event, file) => {
      const handler = findHandler(file);

      console.log(`detected a "${event}" event in "${file}"`);

      if (handler) {
        handler(event, file);
      } else {
        server.reload();
      }
    });
});
