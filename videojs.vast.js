(function(vjs, vast) {
"use strict";
  var
  extend = function(obj) {
    var arg, i, k;
    for (i = 1; i < arguments.length; i++) {
      arg = arguments[i];
      for (k in arg) {
        if (arg.hasOwnProperty(k)) {
          obj[k] = arg[k];
        }
      }
    }
    return obj;
  },

  defaults = {
    skip: 5, // negative disables
    bitrate: 1000, //advised bitrate for VPAID ads
    viewMode: 'normal', //view mode for VPAID ads. Possible values: normal, thumbnail, fullscreen
    vpaidElement: undefined //html element used for vpaid ads
  },

  vastPlugin = function(options) {
    var player = this;
    var settings = extend({}, defaults, options || {});
    var vpaidObj, vpaidListeners = {}, vpaidIFrame = null;

    if (player.ads === undefined) {
        console.log("VAST requires videojs-contrib-ads");
        return;
    }

    // If we don't have a VAST url, just bail out.
    if(settings.url === undefined) {
      player.trigger('adtimeout');
      return;
    }

    // videojs-ads triggers this when src changes
    player.on('contentupdate', function(){
      player.vast.getContent(settings.url);
    });

    player.on('readyforpreroll', function() {
      //in case we have something simple to show
      if (player.vast.sources) {
        player.vast.preroll();
      } else {
        player.vast.prerollVPAID();
      }
    });

    player.vast.getContent = function(url) {
      vast.client.get(url, function(response) {
        if (response) {
          for (var adIdx = 0; adIdx < response.ads.length; adIdx++) {
            var ad = response.ads[adIdx];
            player.vast.companion = undefined;
            var foundCreative = false, foundCompanion = false, foundVPAID = false;
            for (var creaIdx = 0; creaIdx < ad.creatives.length; creaIdx++) {
              var creative = ad.creatives[creaIdx];
              if (creative.type === "linear" && !foundCreative) {

                if (creative.mediaFiles.length) {

                  var vpaidTech = player.vast.findOptimalVPAIDTech(creative.mediaFiles);
                  if (vpaidTech) {
                    foundVPAID = true;
                    player.vast.initVPAID(vpaidTech, function() {
                      player.trigger('adsready');
                    });
                  } else {
                    player.vast.sources = player.vast.createSourceObjects(creative.mediaFiles);
                    if (!player.vast.sources.length) {
                      player.trigger('adtimeout');
                      return;
                    }
                  }

                  player.vastTracker = new vast.tracker(ad, creative);

                  var errorOccurred = false,
                      canplayFn = function() {
                        this.vastTracker.load();
                      },
                      timeupdateFn = function() {
                        if (isNaN(this.vastTracker.assetDuration)) {
                          this.vastTracker.assetDuration = this.duration();
                        }
                        this.vastTracker.setProgress(this.currentTime());
                      },
                      playFn = function() {
                        this.vastTracker.setPaused(false);
                      },
                      pauseFn = function() {
                        this.vastTracker.setPaused(true);
                      },
                      errorFn = function() {
                        // Inform ad server we couldn't play the media file for this ad
                        vast.util.track(ad.errorURLTemplates, {ERRORCODE: 405});
                        errorOccurred = true;
                        player.trigger('ended');
                      };

                  player.on('canplay', canplayFn);
                  player.on('timeupdate', timeupdateFn);
                  player.on('play', playFn);
                  player.on('pause', pauseFn);
                  player.on('error', errorFn);

                  player.one('ended', function() {
                    player.off('canplay', canplayFn);
                    player.off('timeupdate', timeupdateFn);
                    player.off('play', playFn);
                    player.off('pause', pauseFn);
                    player.off('error', errorFn);
                    if (!errorOccurred) {
                      this.vastTracker.complete();
                    }
                  });

                  foundCreative = true;
                }

              } else if (creative.type === "companion" && !foundCompanion) {

                player.vast.companion = creative;

                foundCompanion = true;

              }
            }

            if (player.vastTracker) {
              //vpaid will trigger adsready in async manner when all assets are loaded
              if (!foundVPAID) {
                player.trigger("adsready");
              }
              break;
            } else {
              // Inform ad server we can't find suitable media file for this ad
              vast.util.track(ad.errorURLTemplates, {ERRORCODE: 403});
            }
          }
        }

        if (!player.vastTracker) {
          // No pre-roll, start video
          player.trigger('adtimeout');
        }
      });
    };

    player.vast.createSkipButton = function() {
      var skipButton = document.createElement("div");
      skipButton.className = "vast-skip-button";
      if (settings.skip < 0) {
        skipButton.style.display = "none";
      }
      player.vast.skipButton = skipButton;
      player.el().appendChild(skipButton);

      skipButton.onclick = function (e) {
        if ((' ' + player.vast.skipButton.className + ' ').indexOf(' enabled ') >= 0) {
          player.vastTracker.skip();
          player.vast.tearDown();
          if (player.vast.vpaid) {
            player.vast.vpaid.skipAd();
          }
        }
        if (Event.prototype.stopPropagation !== undefined) {
          e.stopPropagation();
        } else {
          return false;
        }
      };
    };

    player.vast.preroll = function() {
      player.ads.startLinearAdMode();
      player.vast.showControls = player.controls();
      if (player.vast.showControls ) {
        player.controls(false);
      }
      player.autoplay(true);
      // play your linear ad content
      var adSources = player.vast.sources;
      player.src(adSources);

      var clickthrough;
      if (player.vastTracker.clickThroughURLTemplate) {
        clickthrough = vast.util.resolveURLTemplates(
          [player.vastTracker.clickThroughURLTemplate],
          {
            CACHEBUSTER: Math.round(Math.random() * 1.0e+10),
            CONTENTPLAYHEAD: player.vastTracker.progressFormated()
          }
        )[0];
      }
      var blocker = document.createElement("a");
      blocker.className = "vast-blocker";
      blocker.href = clickthrough || "#";
      blocker.target = "_blank";
      blocker.onclick = function() {
        if (player.paused()) {
          player.play();
          return false;
        }
        var clicktrackers = player.vastTracker.clickTrackingURLTemplate;
        if (clicktrackers) {
          player.vastTracker.trackURLs([clicktrackers]);
        }
        player.trigger("adclick");
      };
      player.vast.blocker = blocker;
      player.el().insertBefore(blocker, player.controlBar.el());

      player.vast.createSkipButton();
      player.on("timeupdate", player.vast.timeupdate);
      player.one("ended", player.vast.tearDown);
    };

    player.vast.prerollVPAID = function() {
      player.ads.startLinearAdMode();
      player.vast.oneVPAID('AdStopped', function() {
        player.vast.tearDown();
      });
      vpaidObj.startAd();
    };

    player.vast.tearDown = function() {
      if (!vpaidObj) {
        player.vast.skipButton.parentNode.removeChild(player.vast.skipButton);
        player.vast.blocker.parentNode.removeChild(player.vast.blocker);
      }
      player.off('timeupdate', player.vast.timeupdate);
      player.off('ended', player.vast.tearDown);
      player.ads.endLinearAdMode();
      if (player.vast.showControls ) {
        player.controls(true);
      }

      if (vpaidObj) {
        for (var event in vpaidListeners) {
          if (!vpaidListeners.hasOwnProperty(event)) {
            continue;
          }
          var listeners = vpaidListeners[event];
          for (var i = 0; i < listeners.length; i++) {
            vpaidObj.unsubscribe(listeners[i], event);
          }
        }
        if (vpaidIFrame) {
          vpaidIFrame.parentNode.removeChild(vpaidIFrame);
        }
        vpaidObj = null;
        vpaidIFrame = null;
        vpaidListeners = {};
      }
    };

    player.vast.timeupdate = function(e) {
      player.loadingSpinner.el().style.display = "none";
      var timeLeft = Math.ceil(settings.skip - player.currentTime());
      if(timeLeft > 0) {
        player.vast.skipButton.innerHTML = "Skip in " + timeLeft + "...";
      } else {
        if((' ' + player.vast.skipButton.className + ' ').indexOf(' enabled ') === -1){
          player.vast.skipButton.className += " enabled";
          player.vast.skipButton.innerHTML = "Skip";
        }
      }
    };
    player.vast.createSourceObjects = function (media_files) {
      var sourcesByFormat = {}, i, j, tech;
      var techOrder = player.options().techOrder;
      for (i = 0, j = techOrder.length; i < j; i++) {
        var techName = techOrder[i].charAt(0).toUpperCase() + techOrder[i].slice(1);
        tech = window.videojs[techName];

        // Check if the current tech is defined before continuing
        if (!tech) {
          continue;
        }

        // Check if the browser supports this technology
        if (tech.isSupported()) {
          // Loop through each source object
          for (var a = 0, b = media_files.length; a < b; a++) {
            var media_file = media_files[a];
            var source = {type:media_file.mimeType, src:media_file.fileURL};
            // Check if source can be played with this technology
            if (tech.canPlaySource(source)) {
              if (sourcesByFormat[techOrder[i]] === undefined) {
                sourcesByFormat[techOrder[i]] = [];
              }
              sourcesByFormat[techOrder[i]].push({
                type:media_file.mimeType,
                src: media_file.fileURL,
                width: media_file.width,
                height: media_file.height
              });
            }
          }
        }
      }
      // Create sources in preferred format order
      var sources = [];
      for (j = 0; j < techOrder.length; j++) {
        tech = techOrder[j];
        if (sourcesByFormat[tech] !== undefined) {
          for (i = 0; i < sourcesByFormat[tech].length; i++) {
            sources.push(sourcesByFormat[tech][i]);
          }
        }
      }
      return sources;
    };

    //Find optimal available VPAID tech. Best match is javascript, otherwise last found will be returned
    player.vast.findOptimalVPAIDTech = function(mediaFiles) {
      var foundTech = null;
      for (var i = 0; i < mediaFiles.length; i++) {
        var mediaFile = mediaFiles[i];
        if (mediaFile.apiFramework != "VPAID") {
          continue;
        }

        if (mediaFile.mimeType == 'application/javascript') {
          //bingo!
          return mediaFile;
        } else {
          foundTech = mediaFile;
        }
      }

      return foundTech;
    };

    player.vast.loadVPAIDResource = function(mediaFile, callback) {
      if (mediaFile.mimeType != "application/javascript") {
        throw new Error("Loading not javascript vpaid ads is not supported");
      }

      vpaidIFrame = document.createElement('iframe');
      vpaidIFrame.style.display = 'none';
      vpaidIFrame.onload = function() {
        var iframeDoc = vpaidIFrame.contentDocument;
        //Credos http://stackoverflow.com/a/950146/51966
        // Adding the script tag to the head as suggested before
        var head = iframeDoc.getElementsByTagName('head')[0];
        var script = iframeDoc.createElement('script');
        script.type = 'text/javascript';
        script.src = mediaFile.fileURL;

        // Then bind the event to the callback function.
        // There are several events for cross browser compatibility.
        script.onreadystatechange = script.onload = function() {
          if (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") {
            if (vpaidIFrame.contentWindow.getVPAIDAd === undefined) {
              console.log("Unable to load script or script do not have getVPAIDAd method");
              return;
            }

            callback(vpaidIFrame.contentWindow.getVPAIDAd());
          }
        };

        head.appendChild(script);
      };

      document.body.appendChild(vpaidIFrame);
    };

    player.vast.initVPAID = function (vpaidTech, cb) {
      player.vast.loadVPAIDResource(vpaidTech, function(vpaid) {
        vpaidObj = vpaid;
        if (vpaid.handshakeVersion('2.0') != '2.0') {
          throw new Error("Versions different to 2.0 are not supported");
        }

        var videoPlayer = player.el().querySelector('.vjs-tech');
        var pref = {
          videoSlot: videoPlayer, //need video node itself
          videoSlotCanAutoPlay: true,
          slot: player.el()
        };

        player.vast.onVPAID('AdError', function() {
          console.log('AdError', JSON.stringify(arguments));
          player.vast.tearDown();
        });
        player.on('resize', function() {
          vpaid.resizeAd(player.width(), player.height(), settings.viewMode);
        });
        player.on('fullscreenchange', function() {
          if (player.isFullScreen()) {
            vpaid.resizeAd(0, 0, 'fullscreen');
          } else {
            vpaid.resizeAd(player.width, player.width, settings.viewMode);
          }
        });
        //subscribe to trigger load complete event when vpaid ad is ready
        if (cb) {
          player.vast.oneVPAID('AdLoaded', function() {
            cb(vpaid);
          });
        }

        //TODO add creativeData
        vpaid.initAd(player.width(), player.height(), settings.viewMode, settings.bitrate, {}, pref);
      });
    };

    player.vast.onVPAID = function(event, func) {
      if (vpaidListeners[event] === undefined) {
        vpaidListeners[event] = [];
      }
      vpaidListeners[event].push(func);
      vpaidObj.subscribe(func, event);
    };

    player.vast.offVPAID = function(event, func) {
      vpaidObj.unsubscribe(func, event);
      if (vpaidListeners[event]) {
        var listeners = vpaidListeners[event],
          index = -1;
        if (!Array.prototype.indexOf) {
          for (var i = 0; i < listeners.length; i++) {
            if (listeners[i] == func) {
              index = i;
              break;
            }
          }
        } else {
          index = listeners.indexOf(func);
        }

        if (index != -1) {
          listeners.splice(index, 1);
        }
        if (listeners.length === 0) {
          delete vpaidListeners[event];
        }
      }
    };

    player.vast.oneVPAID = function(event, func) {
      var wrapper = function() {
        func();
        player.vast.offVPAID(event, wrapper);
      };
      player.vast.onVPAID(event, wrapper);
    };

    // make an ads request immediately so we're ready when the viewer
    // hits "play"
    if (player.currentSrc()) {
      player.vast.getContent(settings.url);
    }
  };

  vjs.plugin('vast', vastPlugin);
}(window.videojs, window.DMVAST));
