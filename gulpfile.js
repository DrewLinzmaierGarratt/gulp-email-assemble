// ## Globals
var fs           = require('fs');
var path         = require('path');
var del          = require('del');
var colors       = require('colors');

var argv         = require('minimist')(process.argv.slice(2));
var autoprefixer = require('gulp-autoprefixer');
var changed      = require('gulp-changed');
var gulp         = require('gulp');
var gulpif       = require('gulp-if');
var imagemin     = require('gulp-imagemin');
var cssNano      = require('gulp-cssnano');
var plumber      = require('gulp-plumber');
var runSequence  = require('run-sequence');
var sass         = require('gulp-sass');
var sourcemaps   = require('gulp-sourcemaps');
var rename       = require('gulp-rename');
var replace      = require('gulp-replace');
var debug        = require('gulp-debug');
var toJson       = require('gulp-to-json');
var htmlmin      = require('gulp-htmlmin');

var assemble     = require('assemble');
var helpers      = require('handlebars-helpers')();
var yaml         = require('js-yaml');
var extname      = require('gulp-extname');
var juice        = require('gulp-juice-concat-enhanced');

var browserSync  = require('browser-sync').create();
var htmlInjector = require("bs-html-injector");

browserSync.use(htmlInjector)

var assmbleApps = [];

var s3Config = JSON.parse(fs.readFileSync('aws.json'));
var s3       = require('gulp-s3-upload')(s3Config);

var paths = {
  src: './src',
  assemble: './assemble',
  preview: './preview',
  dist: './dist',
  emails: './src/emails',
  shared: './src/shared'
};

var juiceOptions = {
  preserveMediaQueries: true,
  applyAttributesTableElements: true,
  applyWidthAttributes: true,
  preserveImportant: true,
  preserveFontFaces: true,
  webResources: {
    images: false
  }
}

// CLI options
var enabled = {
  // Enable s3upload when `--production`
  s3: argv.production,
  maps: !argv.production
};

//
var emailFolder = (argv.email === undefined) ? false : true;
var emailTemplate = (argv.template === undefined) ? false : true;


// ### CSS processing function
function assembleOutput(dir, type, min) {
  type = type || 'email';
  min = min || false;

  //Load Assemble App Per Folder
  gulp.task('assembleLoad--'+dir, function(cb) {
    assmbleApps[dir] = assemble();
    assmbleApps[dir].dataLoader('yml', function(str, fp) {
      return yaml.safeLoad(str);
    });
    assmbleApps[dir].partials([path.join(paths.shared, '/templates/partials/**/*.hbs'),path.join(paths.emails, dir, '/templates/partials/**/*.hbs')]);
    assmbleApps[dir].layouts([path.join(paths.shared, '/templates/layouts/**/*.hbs'),path.join(paths.emails, dir, '/templates/layouts/**/*.hbs')]);
    assmbleApps[dir].pages(path.join(paths.emails, dir, '/templates/email/**/*.hbs'));
    assmbleApps[dir].data([path.join(paths.shared, '/data/**/*.{json,yml}'),path.join(paths.emails, dir, '/data/**/*.{json,yml}')]);
    assmbleApps[dir].option('layout', 'base');

    cb();
  });

  //Assemble Content per Folder (Load content first)
  gulp.task('assembleEmail--'+dir, ['assembleLoad--'+dir], function() {
    return assmbleApps[dir].toStream('pages')
      .pipe(debug({title: 'Assemble Email:'}))
      .pipe(assmbleApps[dir].renderFile())
      //.pipe(htmlmin({collapseWhitespace: true}))
      .pipe(extname())
      .pipe(rename({
        dirname: dir
      }))
      .pipe(assmbleApps[dir].dest(paths.assemble));
  });

  //Assemble Stylesheets
  gulp.task('assembleStyles--'+dir, function() {
    return gulp.src(path.join(paths.emails, dir, '/styles/**/*.scss'))
      .pipe(debug({title: 'Assemble Sass:'}))
      .pipe(sourcemaps.init())
      .pipe(sass({
          outputStyle: 'nested', // libsass doesn't support expanded yet
          precision: 10,
          includePaths: path.join(paths.shared, '/styles')
        }).on('error', sass.logError)
      )
      .pipe(autoprefixer({
        browsers: [
          'last 6 versions',
          'ie 9'
        ]})
      )
      .pipe(gulpif(enabled.maps, sourcemaps.write('.', {
        sourceRoot: 'assets/styles/'
      })))
      .pipe(rename({
        dirname: dir + '/styles'
      }))
      .pipe(gulp.dest(paths.assemble));
  });

  //Juice HTML and Styles
  gulp.task('juiceEmail--'+dir, function() {

    //Animation file check
    var animationCheck = false;
    var animationCss = false;
    fs.stat(path.join(paths.assemble, dir, '/styles/animation.css'), function(err, stat) {
      if(err == null) {
        animationCheck = true;
        animationCss = fs.readFileSync(path.join(paths.assemble, dir, '/styles/animation.css'), "utf8");
      }
    });

    return gulp.src(path.join(paths.assemble, dir, '/**/*.html'))
      .pipe(debug({title: 'Juice Email:'}))
      .pipe(juice(juiceOptions))

      .pipe(replace('[mso_open]', '<!--[if (gte mso 9)|(IE)]>'))
      .pipe(replace('[mso_close]', '<![endif]-->'))

      .pipe(replace('[mso_11_open]', '<!--[if gte mso 11]>'))
      .pipe(replace('[mso_11_close]', '<![endif]-->'))

      .pipe(replace('[mso_bg_open]', '<!--[if gte mso 11]>'))
      .pipe(replace('[mso_bg_close]', '<![endif]-->'))

      .pipe(replace('[not_mso_open]', '<!--[if !gte mso 11]><!---->'))
      .pipe(replace('[not_mso_close]', '<!--<![endif]-->'))

      .pipe(replace('[go_mso_open]', '<!--[if mso]><!---->'))
      .pipe(replace('[go_mso_close]', '<!--<![endif]-->'))

      .pipe(replace('[no_mso_open]', '<!--[if !mso]><!---->'))
      .pipe(replace('[no_mso_close]', '<!--<![endif]-->'))

      .pipe(replace('[google_font_open]', '<link href="'))
      .pipe(replace('[google_font_close]', '" rel="stylesheet">'))

      .pipe(gulpif(animationCheck, replace('[animation_css]', '<style type="text/css">'+animationCss+'</style>')))

      .pipe(rename({
        dirname: dir
      }))
      .pipe(gulp.dest(paths.dist));
  });

  //S3 Upload
  gulp.task('s3upload--'+dir, function(callback) {
    gulp.src([path.join(paths.shared, '/images/**/*.{jpeg,jpg,gif,png}'),path.join(paths.emails, dir, '/images/**/*.{jpeg,jpg,gif,png}')])
      .pipe(s3({
          Bucket: s3Config.bucket,
          ACL: 'public-read',
          keyTransform: function(relative_filename) {
              var new_name = 'mail_images/' + dir + '/' + relative_filename;
              return new_name;
          }
      }));

    gulp.src(path.join(paths.dist, dir, '/**/*.html'))
      .pipe(debug({title: 'S3 Replace:'+dir}))

      .pipe(replace(/images\/(\S+\.)(png|jpe?g|gif)/ig, s3Config.baseUrl+'/'+s3Config.bucket+'/mail_images/'+dir+'/$1$2'))

      .pipe(gulp.dest(path.join(paths.dist, dir)));

    callback();
  });

  //Assemble Switch

  //accepts 'email', 'styles' or 'both'
  //enabled.s3 is also checked for asset upload
  switch (type) {
    case "email":
      if(!enabled.s3) {
        runSequence('assembleEmail--'+dir,'juiceEmail--'+dir, 'emailsJson', htmlInjector);
      } else {
        runSequence('assembleEmail--'+dir,'juiceEmail--'+dir, 's3upload--'+dir, 'emailsJson', htmlInjector);
      }

      break;

    case "styles":
      if(!enabled.s3) {
        runSequence('assembleStyles--'+dir,'juiceEmail--'+dir, htmlInjector);
      } else {
        runSequence('assembleStyles--'+dir,'juiceEmail--'+dir, 's3upload--'+dir, htmlInjector);
      }

      break;

    case "both":
      if(!enabled.s3) {
        runSequence('assembleEmail--'+dir,'assembleStyles--'+dir,'juiceEmail--'+dir, 'emailsJson', htmlInjector);
      } else {
        runSequence('assembleEmail--'+dir,'assembleStyles--'+dir,'juiceEmail--'+dir, 's3upload--'+dir, 'emailsJson', htmlInjector);
      }

      break;
  }
};


// ### Image processing function
function processImages(dir,file) {
  file = file || '';

  gulp.task('images', function() {
    return gulp.src(file == '' ? [path.join(paths.shared, '/images/**/*.{jpeg,jpg,gif,png}'),path.join(paths.emails, dir, '/images/**/*.{jpeg,jpg,gif,png}')] : file)
      .pipe(imagemin({
        progressive: true,
        interlaced: true,
        svgoPlugins: [{removeUnknownsAndDefaults: false}, {cleanupIDs: false}]
      }))
      .pipe(rename({
        dirname: dir + '/images'
      }))
      .pipe(gulp.dest(paths.dist))
      .pipe(browserSync.stream());
  });

  gulp.start('images');
}

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

// ### Clean
// `gulp clean` - Deletes the dist and assemble folder entirely.
gulp.task('clean', require('del').bind(null, [paths.dist,paths.assemble]));

// ### Serve
// `gulp serve` - Use BrowserSync to proxy your dev server and synchronize code
// changes across devices.
// See: http://www.browsersync.io
gulp.task('serve', function() {
  // register the plugin
  browserSync.init({
    port: 8080,
    server: "./",
    startPath: "/preview",
    codeSync: false,
    notify: false
  });

  //Prepare Email List for Serve
  gulp.start('emailsJson');

  var folders = getFolders(paths.emails);
  var tasks = folders.map(function(folder) {
    assmbleApps[folder] = assemble();
  });

  //Images Folder Watch
  gulp.watch(path.join(paths.emails, '/**/images/**/*.{jpeg,jpg,gif,png}')).on('change', function (file) {
    var currentFolder = getCurrentFolder(file.path,'emails');

    switch (file.type) {
      case "renamed":
        //Remove old
        var filePath = path.parse(file.old);

        var oldFilePath = path.join(currentFolder , "/images", filePath.name + filePath.ext);
        var oldDestFilePath = path.resolve(paths.dist, oldFilePath);

        del(oldDestFilePath);

        break;

      case "deleted":
        var filePath = path.parse(file.path);

        var filePath = path.join(currentFolder , "/images", filePath.name + filePath.ext);
        var destFilePath = path.resolve(paths.dist, filePath);

        del(destFilePath);

        break;
    }
    processImages(currentFolder,file.path);

  });

  //Styles Folder Watch
  gulp.watch(path.join(paths.emails, '/**/styles/**/*.{scss,less}')).on('change', function (file) {
    var currentFolder = getCurrentFolder(file.path,'emails');

    assembleOutput(currentFolder,'styles');

  });

  //Email Folder Watch
  gulp.watch(path.join(paths.emails, '/**/*.{hbs,json,yml}')).on('change', function (file) {
    var currentFolder = getCurrentFolder(file.path,'emails');

    switch (file.type) {
      case "renamed":
        //Remove old
        var oldPathArray = file.old.split(path.sep);
        var oldFilename = oldPathArray[oldPathArray.length-1];
        oldFilename = oldFilename.substr(0, oldFilename.lastIndexOf('.'));

        var oldFilePath = path.join(currentFolder, oldFilename + ".html");
        var oldDestFilePath = path.resolve(paths.dist, oldFilePath);

        del(oldDestFilePath);

        break;

      case "deleted":
        var pathArray = file.path.split(path.sep);
        var filename = pathArray[pathArray.length-1];
        filename = filename.substr(0, filename.lastIndexOf('.'));

        var filePath = path.join(currentFolder, filename + ".html");
        var destFilePath = path.resolve(paths.dist, filePath);

        del(destFilePath);

        break;
    }
    assembleOutput(currentFolder);

  });

  //Shared Image Folder Watch
  gulp.watch(path.join(paths.shared, '/images/**/*.{jpeg,jpg,gif,png}')).on('change', function (file) {
    var folders = getFolders(paths.emails);

    var tasks = folders.map(function(currentFolder) {
      switch (file.type) {
      case "renamed":
        //Remove old
        var filePath = path.parse(file.old);

        var oldFilePath = path.join(currentFolder , "/images", filePath.name + filePath.ext);
        var oldDestFilePath = path.resolve(paths.dist, oldFilePath);

        del(oldDestFilePath);

        break;

      case "deleted":
        var filePath = path.parse(file.path);

        var filePath = path.join(currentFolder , "/images", filePath.name + filePath.ext);
        var destFilePath = path.resolve(paths.dist, filePath);

        del(destFilePath);

        break;
      }
      processImages(currentFolder);

    });
  });

  //Shared Email Folder Watch
  gulp.watch(path.join(paths.shared, '/**/*.{hbs,json,yml}')).on('change', function (file) {
    var folders = getFolders(paths.emails);

    var tasks = folders.map(function(currentFolder) {
      assembleOutput(currentFolder,'both');
    });
  });

});


// ### Preview Stylesheets
gulp.task('previewStyles', function() {
  return gulp.src(path.join(paths.preview, '/styles/scss/**/*.scss'))
    .pipe(debug({title: 'Preview Sass:'}))
    .pipe(sourcemaps.init())
    .pipe(sass({
        outputStyle: 'nested', // libsass doesn't support expanded yet
        precision: 10,
        includePaths: path.join(paths.shared, '/styles')
      }).on('error', sass.logError)
    )
    .pipe(autoprefixer({
      browsers: [
        'last 2 versions',
        'ie 9',
        'android 2.3',
        'android 4',
        'opera 12'
      ]})
    )
    .pipe(sourcemaps.write())
    .pipe(rename({
      dirname: '/styles'
    }))
    .pipe(gulp.dest(paths.preview));
});


// ### Build
// `gulp build` - Run all the build tasks but don't clean up beforehand.
// Generally you should be running `gulp` instead of `gulp build`.
gulp.task('build', function(callback) {
  var folders = getFolders(paths.emails);

  var tasks = folders.map(function(currentFolder) {
    processImages(currentFolder);
    assembleOutput(currentFolder,'both');
  });

  callback();
});

gulp.task('s3upload', function(callback) {
  var folders = getFolders(paths.emails);

  var tasks = folders.map(function(dir) {
    gulp.src([path.join(paths.shared, '/images/**/*.{jpeg,jpg,gif,png}'),path.join(paths.emails, dir, '/images/**/*.{jpeg,jpg,gif,png}')])
      .pipe(s3({
          Bucket: s3Config.bucket,
          ACL: 'public-read',
          keyTransform: function(relative_filename) {
              var new_name = 'mail_images/' + dir + '/' + relative_filename;
              return new_name;
          }
      }));

    gulp.src(path.join(paths.dist, dir, '/**/*.html'))
      .pipe(debug({title: 'S3 Replace:'}))

      .pipe(replace(/images\/(\S+\.)(png|jpe?g|gif)/ig, s3Config.baseUrl+'/'+s3Config.bucket+'/mail_images/'+dir+'/$1$2'))

      .pipe(gulp.dest(path.join(paths.dist, dir)));
  });

  callback;
});

// ### Email List to Json
gulp.task('emailsJson', function() {
  return gulp.src(path.join(paths.dist,'/**/*.html'))
  .pipe(toJson({
    relative: true,
    filename: path.join(paths.preview,'/scripts/emails.json')
  }));
});

// ### Gulp
// `gulp` - Run a complete build. To compile for production run `gulp --production`.
gulp.task('default', ['clean'], function() {
  runSequence('previewStyles','build');
});
