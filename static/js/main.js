(function(){

    var debug = false;

    //For drawing part
    var mouse = { 
      click: false,
      move: false,
      pos: {x:0, y:0},
      pos_prev: false 
    };

    function getMousePos(canvas, evt) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: (evt.clientX - rect.left) / (rect.right - rect.left) * canvas.width,
            y: (evt.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height
        };
    }

    // ***************************************************************************
    // Socket.io events
    // ***************************************************************************
    
    var socket = io.connect(window.location.host);

    // Connection established
    socket.on('connected', function (data) {
        console.log(data);

        // Get users connected to mainroom
        socket.emit('getUsersInRoom', {'room':'MainRoom'});

        if (debug) {
            // Subscription to rooms
            socket.emit('subscribe', {'username':'sergio', 'rooms':['sampleroom']});

            // Send sample message to room
            socket.emit('newMessage', {'room':'sampleroom', 'msg':'Hellooooooo!'});

            // Auto-disconnect after 10 minutes
            setInterval(function() {
                socket.emit('unsubscribe', {'rooms':['sampleroom']});
                socket.disconnect();
            }, 600000);
        }
    });

    // Disconnected from server
    socket.on('disconnect', function (data) {
        var info = {'room':'MainRoom', 'username':'ServerBot', 'msg':'----- Lost connection to server -----'};
        addMessage(info);
    });
    
    // Reconnected to server
    socket.on('reconnect', function (data) {
        var info = {'room':'MainRoom', 'username':'ServerBot', 'msg':'----- Reconnected to server -----'};
        addMessage(info);
    });

    //TODO
    socket.on('createRoomFailed', function (data) {
        console.log("room already exists");
    });

    //TODO
    socket.on('subscriptionFailed', function (data) {
        console.log("wrong room details entered");
    });

    // Subscription to room confirmed
    socket.on('subscriptionConfirmed', function(data) {
        // Create room space in interface
        if (!roomExists(data.room)) {
            addRoomTab(data.room);
            addRoom(data.room);
        }

        // Close modal if opened
        $('#modal_joinroom').modal('hide');
        $('#modal_createroom').modal('hide');
    });

    // Unsubscription to room confirmed
    socket.on('unsubscriptionConfirmed', function(data) {
        // Remove room space in interface
        if (roomExists(data.room)) {
            removeRoomTab(data.room);
            removeRoom(data.room);
        }
    });

    // User joins room
    socket.on('userJoinsRoom', function(data) {
        console.log("userJoinsRoom: %s", JSON.stringify(data));
        // Log join in conversation
        addMessage(data);
    
        // Add user to connected users list
        addUser(data);
    });

    // User leaves room
    socket.on('userLeavesRoom', function(data) {
        console.log("userLeavesRoom: %s", JSON.stringify(data));
        // Log leave in conversation
        addMessage(data);

        // Remove user from connected users list
        removeUser(data);
    });

    // Message received
    socket.on('newMessage', function (data) {
        console.log("newMessage: %s", JSON.stringify(data));
        addMessage(data);

        // Scroll down room messages
        var room_messages = '#'+data.room+' #room_messages';
        $(room_messages).animate({
            scrollTop: $(room_messages).height()
        }, 300);
    });

    // Users in room received
    socket.on('usersInRoom', function(data) {
        console.log('usersInRoom: %s', JSON.stringify(data));
        _.each(data.users, function(user) {
            addUser(user);
        });
    });

    // User nickname updated
    socket.on('userNicknameUpdated', function(data) {
        console.log("userNicknameUpdated: %s", JSON.stringify(data));
        updateNickname(data);

        msg = '----- ' + data.oldUsername + ' is now ' + data.newUsername + ' -----';
        var info = {'room':data.room, 'username':'ServerBot', 'msg':msg};
        addMessage(info);
    });

    // Draw in room
    socket.on('drawLine', function (data) {
        var queryCanvas = '#' + data.room + ' > #MainRoomCanvas';
        var auxCanvas  = $(queryCanvas)[0];
        var auxContext = auxCanvas.getContext('2d');  
        auxContext.strokeStyle = data.color;
        auxContext.lineWidth = data.lineWidth/2;
        auxContext.lineJoin = 'round';
        auxContext.lineCap = 'round';

        var line = data.line;
        auxContext.beginPath();
        auxContext.moveTo(line[0].x * auxCanvas.width, line[0].y * auxCanvas.height);
        auxContext.lineTo(line[1].x * auxCanvas.width, line[1].y * auxCanvas.height);
        auxContext.stroke();
    });

    // ***************************************************************************
    // Templates and helpers
    // ***************************************************************************
    
    var templates = {};
    var getTemplate = function(path, callback) {
        var source;
        var template;
 
        // Check first if we've the template cached
        if (_.has(templates, path)) {
            if (callback) callback(templates[path]);
        // If not we get and compile it
        } else {
            $.ajax({
                url: path,
                success: function(data) {
                    source = data;
                    template = Handlebars.compile(source);
                    // Store compiled template in cache
                    templates[path] = template;
                    if (callback) callback(template);
                }
            });
        }
    }

    // Add room tab
    var addRoomTab = function(room) {
        getTemplate('js/templates/room_tab.handlebars', function(template) {
            $('#rooms_tabs').append(template({'room':room}));
        });
    };

    // Remove room tab
    var removeRoomTab = function(room) {
        var tab_id = "#"+room+"_tab";
        $(tab_id).remove();
    };

    // Add room
    var addRoom = function(room) {
        getTemplate('js/templates/room.handlebars', function(template) {
            $('#rooms').append(template({'room':room}));

            initCanvas(room);

            // Toogle to created room
            var newroomtab = '[href="#'+room+'"]';
            $(newroomtab).click();

            // Get users connected to room
            socket.emit('getUsersInRoom', {'room':room});
        });
    };
    
    // Remove room
    var removeRoom = function(room) {
        var room_id = "#"+room;
        $(room_id).remove();
    };

    // Add message to room
    var addMessage = function(msg) {
        getTemplate('js/templates/message.handlebars', function(template) {
            var room_messages = '#'+msg.room+' #room_messages';
            $(room_messages).append(template(msg));
        });
    };
    
    // Add user to connected users list
    var addUser = function(user) {
        getTemplate('js/templates/user.handlebars', function(template) {
            var room_users = '#'+user.room+' #room_users';
            // Add only if it doesn't exist in the room
            var user_badge = '#'+user.room+' #'+user.id;
            if (!($(user_badge).length)) {
                $(room_users).append(template(user));
            }
        });
    }

    var initCanvas = function(room) {
        //Prepare the new canvas for the new room
        var canvasWidthRatio = 100/100;
        var canvasHeightRatio = 60/100;
        var queryCanvas = '#' + room + ' > #MainRoomCanvas';
        var canvas  = $(queryCanvas)[0];
        var context = canvas.getContext('2d');
        var width   = $('#MainRoom').width() * canvasWidthRatio;
        var height  = $('#MainRoom').height() * canvasHeightRatio;

        canvas.width = width;
        canvas.height = height;

        canvas.onmousedown = function(e){ mouse.click = true; };
        canvas.onmouseup = function(e){ mouse.click = false; };

        canvas.onmousemove = function(e) {
            // normalize mouse position to range 0.0 - 1.0
            var pos = getMousePos(canvas, e);
            mouse.pos.x = pos.x / width;
            mouse.pos.y = pos.y / height;
            mouse.move = true;
        };
    };

    // Remove user from connected users list
    var removeUser = function(user) {
        var user_badge = '#'+user.room+' #'+user.id;
        $(user_badge).remove();
    };

    // Check if room exists
    var roomExists = function(room) {
        var room_selector = '#'+room;
        if ($(room_selector).length) {
            return true;
        } else {
            return false;
        }
    };

    // Get current room
    var getCurrentRoom = function() {
        return $('li[id$="_tab"][class="active"]').text();
    };

    // Get message text from input field
    var getMessageText = function() {
        var text = $('#message_text').val();
        $('#message_text').val("");
        return text;
    };

    // Get room name to join from input field 
    var getRoomDetailsToJoin = function() {
        var name = $('#room_name_join').val().trim();
        $('#room_name_join').val("");
        var password = $('#room_password_join').val().trim();
        $('#room_password_join').val("");
        return { name: name, password: password };
    };

    var getRoomDetailsToCreate = function() {
        var name = $('#room_name_create').val().trim();
        $('#room_name_create').val("");
        var password = $('#room_password_create').val().trim();
        $('#room_password_create').val("");
        return { name: name, password: password };  
    };

    // Get nickname from input field
    var getNickname = function() {
        var nickname = $('#nickname').val();
        $('#nickname').val("");
        return nickname;
    };

    // Update nickname in badges
    var updateNickname = function(data) {
        var badges = '#'+data.room+' #'+data.id;
        $(badges).text(data.newUsername);
    };

    // ***************************************************************************
    // Events
    // ***************************************************************************

    // Send new message
    $('#b_send_message').click(function(eventObject) {
        eventObject.preventDefault();
        if ($('#message_text').val() != "") {
            socket.emit('newMessage', {'room':getCurrentRoom(), 'msg':getMessageText()});
        }
    });

    // Join new room
    $('#b_join_room').click(function(eventObject) {
        var roomData = getRoomDetailsToJoin();

        if (roomData.name && roomData.password) {
            eventObject.preventDefault();
            socket.emit('subscribe', {'rooms':[roomData]}); 

        // Added error class if empty room name
        } else {
            $('#room_name_join').addClass('error');
            $('#room_password_join').addClass('error');
        }
    });

    $('#b_create_room').click(function(eventObject) {
        var roomData = getRoomDetailsToCreate();

        if (roomData.name && roomData.password) {
            eventObject.preventDefault();
            socket.emit('createRoom', {'rooms':[roomData]});

        // Added error class if empty room name
        } else {
            $('#room_name_create').addClass('error');
            $('#room_password_create').addClass('error');
        }
    });

    // Leave current room
    $('#b_leave_room').click(function(eventObject) {
        eventObject.preventDefault();
        var currentRoom = getCurrentRoom();
        if (currentRoom != 'MainRoom') {
            socket.emit('unsubscribe', {'rooms':[getCurrentRoom()]}); 

            // Toogle to MainRoom
            $('[href="#MainRoom"]').click();
        } else {
            console.log('Cannot leave MainRoom, sorry');
        }
    });

    // Remove error style to hide modal
    $('#modal_joinroom').on('hidden.bs.modal', function (e) {
        if ($('#room_name').hasClass('error')) {
            $('#room_name').removeClass('error');
        }
    });

    // Set nickname
    $('#b_set_nickname').click(function(eventObject) {
        eventObject.preventDefault();
        socket.emit('setNickname', {'username':getNickname()});

        // Close modal if opened
        $('#modal_setnick').modal('hide');
    });
    setTimeout(function() {
        $('#modal_setnick').modal('show');
    }, 300);

    //DRAWING PART

    initCanvas('MainRoom');

    function mainLoop() {
      // check if the user is drawing
      if (mouse.click && mouse.move && mouse.pos_prev) {
        // send line to to the server
        socket.emit('drawLine', { line: [ mouse.pos, mouse.pos_prev ], 'room':getCurrentRoom(), 'color': currentColor, 'lineWidth': lineWidth });
        mouse.move = false;
      }
      mouse.pos_prev = {x: mouse.pos.x, y: mouse.pos.y};
      setTimeout(mainLoop, 25);
   }
   mainLoop();

})();

