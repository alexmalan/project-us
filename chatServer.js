// ***************************************************************************
// General
// ***************************************************************************

var conf = { 
    port: 8888,
    debug: false,
    dbPort: 6379,
    dbHost: '127.0.0.1',
    dbOptions: {},
    mainroom: 'MainRoom'
};

// External dependencies
var express = require('express'),
    http = require('http'),
    events = require('events'),
    _ = require('underscore'),
    sanitize = require('validator').sanitize;

// HTTP Server configuration & launch
var app = express(),
    server = http.createServer(app);
    server.listen(conf.port);

// Express app configuration
app.configure(function() {
    app.use(express.bodyParser());
    app.use(express.static(__dirname + '/static'));
});

var io = require('socket.io')(server);
var redis = require('socket.io-redis');
io.adapter(redis({ host: conf.dbHost, port: conf.dbPort }));

var db = require('redis').createClient(conf.dbPort,conf.dbHost);

// Logger configuration
var logger = new events.EventEmitter();
logger.on('newEvent', function(event, data) {
    // Console log
    console.log('%s: %s', event, JSON.stringify(data));
    // Persistent log storage too?
    // TODO
});

// ***************************************************************************
// Express routes helpers
// ***************************************************************************

// Only authenticated users should be able to use protected methods
var requireAuthentication = function(req, res, next) {
    // TODO
    next();
};

// Sanitize message to avoid security problems
var sanitizeMessage = function(req, res, next) {
    if (req.body.msg) {
        req.sanitizedMessage = sanitize(req.body.msg).xss();
        next();
    } else {
        res.send(400, "No message provided");
    }
};

// Send a message to all active rooms
var sendBroadcast = function(text) {
    _.each(io.nsps['/'].adapter.rooms, function(room) {
        if (room) {
            var message = {'room':room, 'username':'ServerBot', 'msg':text, 'date':new Date()};
            io.to(room).emit('newMessage', message);
        }
    });
    logger.emit('newEvent', 'newBroadcastMessage', {'msg':text});
};

// ***************************************************************************
// Express routes
// ***************************************************************************

// Welcome message
app.get('/', function(req, res) {
    res.send(200, "Welcome to chat server");
});

// Broadcast message to all connected users
app.post('/api/broadcast/', requireAuthentication, sanitizeMessage, function(req, res) {
    sendBroadcast(req.sanitizedMessage);
    res.send(201, "Message sent to all rooms");
}); 

// ***************************************************************************
// Socket.io events
// ***************************************************************************

io.sockets.on('connection', function(socket) {

    // Welcome message on connection
    socket.emit('connected', 'Welcome to the chat server');
    logger.emit('newEvent', 'userConnected', {'socket':socket.id});

    // Store user data in db
    db.hset([socket.id, 'connectionDate', new Date()], redis.print);
    db.hset([socket.id, 'socketID', socket.id], redis.print);
    db.hset([socket.id, 'username', 'anonymous'], redis.print);

    // Join user to 'MainRoom'
    socket.join(conf.mainroom);
    logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'room':conf.mainroom});
    // Confirm subscription to user
    socket.emit('subscriptionConfirmed', {'room':conf.mainroom});

    //Send line history to the new joined
    db.lrange(conf.mainroom + "_historyDraw", 0, -1, function(error, allLines) {
        if (error) console.log(error);
        allLines.forEach(function (line) {
            line = line.split(" ");
            var mouse = {};
            mouse.pos = { x: line[0], y: line[1] };
            mouse.pos_prev = { x: line[2], y: line[3] };
            socket.emit('drawLine', { line: [ mouse.pos, mouse.pos_prev ], 'room': conf.mainroom, 'color': line[4], 'lineWidth': line[5] });
        });
    });

    //Send chat history to the new joined
    db.lrange(conf.mainroom + "_historyChat", 0, -1, function(error, allLines) {
        allLines.forEach(function (msg) {
            msg = msg.split("<*>");
            var message = {'room':conf.mainroom, 'username':msg[0], 'msg':msg[1], 'date':msg[2]};
            socket.emit('newMessage', message);
        });
    });


    // Notify subscription to all users in room
    var data = {'room':conf.mainroom, 'username':'anonymous', 'msg':'----- Joined the room -----', 'id':socket.id};
    io.to(conf.mainroom).emit('userJoinsRoom', data);

    // User wants to subscribe to [data.rooms]
    socket.on('createRoom', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {
            _.each(data.rooms, function(room) {
                room.name = room.name.replace(" ","");
                room.password = room.password.replace(" ", "");

                //Get room info from db
                db.hget([room.name, 'roomName'], function(error, roomName) {
                    //Check if room doesn't already exist
                    if (roomName == null) {
                        //Add room to database
                        db.hset([room.name, 'creationDate', new Date()], redis.print);
                        db.hset([room.name, 'roomName', room.name], redis.print);
                        db.hset([room.name, 'roomPassword', room.password], redis.print);

                        // Subscribe user to chosen rooms
                        socket.join(room.name);
                        logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'username':username, 'room':room.name});

                        // Confirm subscription to user
                        socket.emit('subscriptionConfirmed', {'room': room.name});
        
                        // Notify subscription to all users in room
                        var message = {'room':room.name, 'username':username, 'msg':'----- Joined the room -----', 'id':socket.id};
                        io.to(room.name).emit('userJoinsRoom', message);
                    } else {
                        socket.emit('createRoomFailed', {'message': 'Room already exists'});
                    }
                });
            });
        });
    });

    // User wants to subscribe to [data.rooms]
    socket.on('subscribe', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {

            // Subscribe user to chosen rooms
            _.each(data.rooms, function(room) {
                room.name = room.name.replace(" ","");
                room.password = room.password.replace(" ", "");

                //Get room info from db
                db.hget([room.name, 'roomName'], function(error, roomName) {
                    db.hget([room.name, 'roomPassword'], function(error, roomPassword) {
                        if (room.name == roomName && room.password == roomPassword) {
                            socket.join(room.name);
                            logger.emit('newEvent', 'userJoinsRoom', {'socket':socket.id, 'username':username, 'room':room.name});

                            // Confirm subscription to user
                            socket.emit('subscriptionConfirmed', {'room': room.name});

                            //Send drawing history to the new joined
                            db.lrange(roomName + "_historyDraw", 0, -1, function(error, allLines) {
                                if (error) console.log(error);
                                //Set timeout, wait for page to load before sending the coordinates
                                setTimeout(function () {
                                    allLines.forEach(function (line) {
                                        line = line.split(" ");
                                        var mouse = {};
                                        mouse.pos = { x: line[0], y: line[1] };
                                        mouse.pos_prev = { x: line[2], y: line[3] };
                                        socket.emit('drawLine', { line: [ mouse.pos, mouse.pos_prev ], 'room': roomName, 'color': line[4], 'lineWidth': line[5] });
                                    });
                                }, 200);
                            });

                            //Send chat history to the new joined
                            db.lrange(roomName + "_historyChat", 0, -1, function(error, allLines) {
                                if (error) console.log(error);
                                //Set timeout, wait for page to load before sending the history
                                setTimeout(function () {
                                    allLines.forEach(function (msg) {
                                        msg = msg.split("<*>");
                                        var message = {'room':roomName, 'username':msg[0], 'msg':msg[1], 'date':msg[2]};
                                        socket.emit('newMessage', message);
                                    });
                                }, 200);
                            });

                            // Notify subscription to all users in room
                            var message = {'room':room.name, 'username':username, 'msg':'----- Joined the room -----', 'id':socket.id};
                            io.to(room.name).emit('userJoinsRoom', message);
                        } else {
                            socket.emit('subscriptionFailed', { message: 'Room username or password is wrong' });
                        }
                    });
                });
            });
        });
    });

    // User wants to unsubscribe from [data.rooms]
    socket.on('unsubscribe', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {
        
            // Unsubscribe user from chosen rooms
            _.each(data.rooms, function(room) {
                if (room != conf.mainroom) {
                    socket.leave(room);
                    logger.emit('newEvent', 'userLeavesRoom', {'socket':socket.id, 'username':username, 'room':room});
                
                    // Confirm unsubscription to user
                    socket.emit('unsubscriptionConfirmed', {'room': room});
        
                    // Notify unsubscription to all users in room
                    var message = {'room':room, 'username':username, 'msg':'----- Left the room -----', 'id': socket.id};
                    io.to(room).emit('userLeavesRoom', message);
                }
            });
        });
    });

    // User wants to know what rooms he has joined
    socket.on('getRooms', function(data) {
        socket.emit('roomsReceived', socket.rooms);
        logger.emit('newEvent', 'userGetsRooms', {'socket':socket.id});
    });

    // Get users in given room
    socket.on('getUsersInRoom', function(data) {
        var usersInRoom = [];
        var socketsInRoom = _.keys(io.nsps['/'].adapter.rooms[data.room]);
        for (var i=0; i<socketsInRoom.length; i++) {
            db.hgetall(socketsInRoom[i], function(err, obj) {
                usersInRoom.push({'room':data.room, 'username':obj.username, 'id':obj.socketID});
                // When we've finished with the last one, notify user
                if (usersInRoom.length == socketsInRoom.length) {
                    socket.emit('usersInRoom', {'users':usersInRoom});
                }
            });
        }
    });

    // User wants to change his nickname
    socket.on('setNickname', function(data) {
        // Get user info from db
        db.hget([socket.id, 'username'], function(err, username) {

            // Store user data in db
            db.hset([socket.id, 'username', data.username], redis.print);
            logger.emit('newEvent', 'userSetsNickname', {'socket':socket.id, 'oldUsername':username, 'newUsername':data.username});

            // Notify all users who belong to the same rooms that this one
            _.each(socket.rooms, function(room) {
                if (room) {
                    var info = {'room':room, 'oldUsername':username, 'newUsername':data.username, 'id':socket.id};
                    io.to(room).emit('userNicknameUpdated', info);
                }
            });
        });
    });

    // New message sent to group
    socket.on('newMessage', function(data) {
        db.hgetall(socket.id, function(err, obj) {
            if (err) return logger.emit('newEvent', 'error', err);
            // Check if user is subscribed to room before sending his message
            if (_.contains(_.values(socket.rooms), data.room)) {
                var message = {'room':data.room, 'username':obj.username, 'msg':data.msg, 'date':new Date()};
                // Send message to room
                io.to(data.room).emit('newMessage', message);
                logger.emit('newEvent', 'newMessage', message);

                //Add new chat message to chat history
                var stringToPush = obj.username + "<*>" + data.msg + "<*>" + new Date();
                db.rpush(data.room + "_historyChat", stringToPush, function(error) {
                    if (error) console.log(error);
                });
            }
        });
    });

    //User draws something
    socket.on('drawLine', function(data) {
    	db.hgetall(socket.id, function(err, obj) {
    		if (err) return logger.emit('newEvent', 'error', err);
    		// Check if user is subscribed to room before sending his drawing
    		if (_.contains(_.values(socket.rooms), data.room)) {
    			//Send drawing
    			io.to(data.room).emit('drawLine', { line: data.line, 'room': data.room, 'color': data.color, 'lineWidth': data.lineWidth });

                //Add new drawn lines to database history
                var stringToPush = data.line[0].x + " " + data.line[0].y + " " + data.line[1].x + " " + data.line[1].y + " " + data.color + " " + data.lineWidth;
                db.rpush(data.room + "_historyDraw", stringToPush, function(error) {
                    if (error) console.log(error);
                });
    		}
    	});
    });

    // Clean up on disconnect
    socket.on('disconnect', function() {
        
        // Get current rooms of user
        var rooms = socket.rooms;
        
        // Get user info from db
        db.hgetall(socket.id, function(err, obj) {
            if (err) return logger.emit('newEvent', 'error', err);
            logger.emit('newEvent', 'userDisconnected', {'socket':socket.id, 'username':obj.username});

            // Notify all users who belong to the same rooms that this one
            _.each(rooms, function(room) {
                if (room) {
                    var message = {'room':room, 'username':obj.username, 'msg':'----- Left the room -----', 'id':obj.socketID};
                    io.to(room).emit('userLeavesRoom', message);
                }
            });
        });
    
        // Delete user from db
        db.del(socket.id, redis.print);
    });
});

// Automatic message generation (for testing purposes)
if (conf.debug) {
    setInterval(function() {
        var text = 'Testing rooms';
        sendBroadcast(text);
    }, 60000);
}

