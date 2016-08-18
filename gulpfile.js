// ## Globals
var fs           = require('fs');
var path         = require('path');
var del          = require('del');
var argv         = require('minimist')(process.argv.slice(2));
var autoprefixer = require('gulp-autoprefixer');
var browserSync  = require('browser-sync').create();
var htmlInjector = require("bs-html-injector");
var changed      = require('gulp-changed');
var concat       = require('gulp-concat');
var flatten      = require('gulp-flatten');
var gulp         = require('gulp');
var gulpif       = require('gulp-if');
var imagemin     = require('gulp-imagemin');
var jshint       = require('gulp-jshint');
var lazypipe     = require('lazypipe');
var less         = require('gulp-less');
var merge        = require('merge-stream');
var cssNano      = require('gulp-cssnano');
var plumber      = require('gulp-plumber');
var rev          = require('gulp-rev');
var runSequence  = require('run-sequence');
var sass         = require('gulp-sass');
var sourcemaps   = require('gulp-sourcemaps');
var rename       = require('gulp-rename');

var assemble     = require('assemble');
var extname      = require('gulp-extname');
var htmlmin      = require('gulp-htmlmin');
var juice        = require('gulp-juice-concat-enhanced');

var emailsPath = './src/emails';

var assmbleApps = [];
var paths = {};
paths.src = './src';
paths.dist = './dist';

// CLI options
var enabled = {
  // Enable static asset revisioning when `--production`
  rev: argv.production,
  // Disable source maps when `--production`
  maps: !argv.production,
  // Fail styles task on error when `--production`
  failStyleTask: argv.production,
  // Fail due to JSHint warnings only when `--production`
  failJSHint: argv.production,
  // Strip debug statments from javascript when `--production`
  stripJSDebug: argv.production
};

// ## Reusable Pipelines
// See https://github.com/OverZealous/lazypipe

// ### CSS processing pipeline
// Example
// ```
// gulp.src(cssFiles)
//   .pipe(cssTasks('main.css')
//   .pipe(gulp.dest(paths.dist + 'styles'))
// ```
var cssTasks = function(filename) {
  return lazypipe()
    .pipe(function() {
      return gulpif(!enabled.failStyleTask, plumber());
    })
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.init());
    })
    .pipe(function() {
      return gulpif('*.less', less());
    })
    .pipe(function() {
      return gulpif('*.scss', sass({
        outputStyle: 'nested', // libsass doesn't support expanded yet
        precision: 10,
        includepaths: ['.'],
        errLogToConsole: !enabled.failStyleTask
      }));
    })
    .pipe(concat, filename)
    .pipe(autoprefixer, {
      browsers: [
        'last 2 versions',
        'android 4',
        'opera 12'
      ]
    })
    .pipe(cssNano, {
      safe: true
    })
    .pipe(function() {
      return gulpif(enabled.rev, rev());
    })
    .pipe(function() {
      return gulpif(enabled.maps, sourcemaps.write('.', {
        sourceRoot: paths.source + '/assets/styles/'
      }));
    })();
};

var assembleOutput = function(dir,filename) {
  return lazypipe()
    .pipe(function() {
      return assmbleApp.toStream('pages')
    })
    .pipe(assmbleApp.renderFile())
    .pipe(htmlmin())
    .pipe(extname())
    .pipe(assmbleApp.dest(paths.dist));
};

// ### Get folders for iteration
function getFolders(dir) {
  return fs.readdirSync(dir)
    .filter(function(file) {
      return fs.statSync(path.join(dir, file)).isDirectory();
    });
}

// ### Get current folder of watch type
function getCurrentFolder(filePath,type) {
  var pathArray = filePath.split(path.sep);
  var emailPathPos = pathArray.indexOf(type);
  var currentFolder = pathArray[emailPathPos+1];
  return currentFolder;
}

// ### Assemble App Collection Update
function assembleFolder(dir) {
  //Update Assemble App Sources
  assmbleApps[dir] = assemble();
  assmbleApps[dir].partials([path.join(emailsPath, dir, '/templates/partials/**/*.hbs'),'./src/shared/templates/partials/**/*.hbs']);
  assmbleApps[dir].layouts([path.join(emailsPath, dir, '/templates/layouts/**/*.hbs'),'./src/shared/templates/layouts/**/*.hbs']);
  assmbleApps[dir].pages(path.join(emailsPath, dir, '/templates/pages/**/*.hbs'));
  assmbleApps[dir].data([path.join(emailsPath, dir, '/data/**/*.{json,yml}'),'./src/shared/data/**/*.{json,yml}']);
  assmbleApps[dir].option('layout', 'base');
};

function assembleJuice(dir) {    
  return assmbleApps[dir].toStream('pages')
    .pipe(assmbleApps[dir].renderFile())
    .pipe(htmlmin())
    .pipe(extname())
    .pipe(rename({
      dirname: dir
    }))
    .pipe(assmbleApps[dir].dest(paths.dist));
}

// ## Gulp tasks
// Run `gulp -T` for a task summary

// ### Styles
// `gulp styles` - Compiles, combines, and optimizes Bower CSS and project CSS.
// By default this task will only log a warning if a precompiler error is
// raised. If the `--production` flag is set: this task will fail outright.
gulp.task('styles', ['wiredep'], function() {
  var merged = merge();
  manifest.forEachDependency('css', function(dep) {
    var cssTasksInstance = cssTasks(dep.name);
    if (!enabled.failStyleTask) {
      cssTasksInstance.on('error', function(err) {
        console.error(err.message);
        this.emit('end');
      });
    }
    merged.add(gulp.src(dep.globs, {base: 'assets/styles'})
      .pipe(cssTasksInstance));
  });
  return merged
    .pipe(gulp.dest, paths.dist)();
});

// ### Fonts
// `gulp fonts` - Grabs all the fonts and outputs them in a flattened directory
// structure. See: https://github.com/armed/gulp-flatten
gulp.task('fonts', function() {
  return gulp.src(globs.fonts)
    .pipe(flatten())
    .pipe(gulp.dest(paths.dist + 'fonts'))
    .pipe(browserSync.stream());
});

// ### Images
// `gulp images` - Run lossless compression on all the images.
gulp.task('images', function() {
  return gulp.src(globs.images)
    .pipe(imagemin({
      progressive: true,
      interlaced: true,
      svgoPlugins: [{removeUnknownsAndDefaults: false}, {cleanupIDs: false}]
    }))
    .pipe(gulp.dest(paths.dist + 'images'))
    .pipe(browserSync.stream());
});

gulp.task('assemble', function() {
  var folders = getFolders(emailsPath);

  var tasks = folders.map(function(folder) {
  
    //Update Assemble App Sources
    assmbleApp.partials([path.join(emailsPath, folder, '/templates/partials/**/*.hbs'),'./src/shared/templates/partials/**/*.hbs']);
    assmbleApp.layouts([path.join(emailsPath, folder, '/templates/layouts/**/*.hbs'),'./src/shared/templates/layouts/**/*.hbs}']);
    assmbleApp.pages(path.join(emailsPath, folder, '/templates/pages/**/*.hbs'));
    assmbleApp.data([path.join(emailsPath, folder, '/data/**/*.{json,yml}'),'./src/shared/data/**/*.{json,yml}']);
    assmbleApp.option('layout', 'base');
    
    //Run Assemble stream
    return assmbleApp.toStream('pages')
      .pipe(assmbleApp.renderFile())
      .pipe(htmlmin())
      .pipe(extname())
      .pipe(assmbleApp.dest(paths.dist));
  });
});

// ### JSHint
// `gulp jshint` - Lints configuration JSON and project JS.
gulp.task('jshint', function() {
  return gulp.src([
    'bower.json', 'gulpfile.js'
  ].concat(project.js))
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'))
    .pipe(gulpif(enabled.failJSHint, jshint.reporter('fail')));
});

// ### Clean
// `gulp clean` - Deletes the build folder entirely.
gulp.task('clean', require('del').bind(null, [paths.dist]));

// ### Serve
// `gulp serve` - Use BrowserSync to proxy your dev server and synchronize code
// changes across devices. Specify the hostname of your dev server at
// `manifest.config.devUrl`. When a modification is made to an asset, run the
// build step for that asset and inject the changes into the page.
// See: http://www.browsersync.io
gulp.task('serve', function() {
  // register the plugin
  browserSync.use(htmlInjector, {
    // Files to watch that will trigger the injection
    files: "dist/*.html" 
  });
  browserSync.init({
    port: 8080,
    server: "./",
    startPath: "/preview"
  });
  //Init Apps
  var folders = getFolders(emailsPath);
  var tasks = folders.map(function(folder) {
    assmbleApps[folder] = assemble();
    assembleFolder(folder);
  });
  
  //gulp.watch([paths.source + 'styles/**/*'], ['styles']);
  //gulp.watch([paths.source + 'scripts/**/*'], ['jshint', 'scripts']);
  //gulp.watch([paths.source + 'fonts/**/*'], ['fonts']);
  //gulp.watch([paths.source + 'images/**/*'], ['images']);
  
  gulp.watch('dist/**/*.html', htmlInjector);
  gulp.watch(['bower.json', paths.source + 'assets/manifest.json'], ['build']);
  
  //Email Folder Watch
  gulp.watch('src/emails/**/*.{hbs,json,yml}').on('change', function (file) {
    var currentFolder = getCurrentFolder(file.path,'emails');
    
    console.log(file);
    
    switch (file.type) {
      case "added":
        assembleFolder(currentFolder)
        assembleJuice(currentFolder);
      
        break;
        
      case "renamed":
        //Remove old
        var oldPathArray = file.old.split(path.sep);
        var oldFilename = oldPathArray[oldPathArray.length-1];
        
        oldFilename = oldFilename.substr(0, oldFilename.lastIndexOf('.'));
        
        var oldFilePath = currentFolder + path.sep + oldFilename + ".html";
        
        var oldDestFilePath = path.resolve(paths.dist, oldFilePath);
        
        console.log(oldDestFilePath);
        
        return del(oldDestFilePath);
        
        //Add new
        assembleFolder(currentFolder)
        assembleJuice(currentFolder);
      
        break;
        
      case "deleted":
        
        var pathArray = file.path.split(path.sep);
        var filename = pathArray[pathArray.length-1];
        filename = filename.substr(0, filename.lastIndexOf('.'));
        
        var filePath = currentFolder + path.sep + filename + ".html";
        
        var destFilePath = path.resolve(paths.dist, filePath);
        
        console.log(destFilePath);
        
        return del(destFilePath);
        
        assembleFolder(currentFolder)
        assembleJuice(currentFolder);
      
        break;
        
      case "changed":
        assembleJuice(currentFolder);
      
        break;
    }
  });
  
  //Shared Folder Watch
  gulp.watch('src/shared/**/*.{hbs,json,yml}').on('change', function (file) {
    var folders = getFolders(emailsPath);
  
    var tasks = folders.map(function(folder) {
      assembleFolder(folder);
      
      console.log(folder);
      
      return assmbleApp.toStream('pages')
      .pipe(assmbleApp.renderFile())
      .pipe(htmlmin())
      .pipe(extname())
      .pipe(rename({
        dirname: folder
      }))
      .pipe(assmbleApp.dest(paths.dist));
    });
  });
  
});

// ### Build
// `gulp build` - Run all the build tasks but don't clean up beforehand.
// Generally you should be running `gulp` instead of `gulp build`.
gulp.task('build', function(callback) {
  runSequence('styles',
              'scripts',
              ['fonts', 'images'],
              'assemble',
              callback);
});

// ### Wiredep
// `gulp wiredep` - Automatically inject Less and Sass Bower dependencies. See
// https://github.com/taptapship/wiredep
gulp.task('wiredep', function() {
  var wiredep = require('wiredep').stream;
  return gulp.src(project.css)
    .pipe(wiredep())
    .pipe(changed(paths.source + 'styles', {
      hasChanged: changed.compareSha1Digest
    }))
    .pipe(gulp.dest(paths.source + 'styles'));
});

// ### Gulp
// `gulp` - Run a complete build. To compile for production run `gulp --production`.
gulp.task('default', ['clean'], function() {
  gulp.start('build');
});
