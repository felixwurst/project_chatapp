/* ************************************************************ SETUP ******************************************************* */
const path = require('path');
const http = require('http');
const moment = require('moment');
const express = require('express');
const app = express();
const socketio = require('socket.io');

// utils
const {
  insertMessage,
  getMessage,
  formatMessage,
  getMessages
} = require('./utils/messages');
const {
  registerUser,
  loginUser,
  joinUsersRoom,
  leaveUsersRoom,
  getRoomUsers
} = require('./utils/users');
const {
  getRooms,
  getRoom,
  getRoomByUserID,
  createRoom
} = require('./utils/rooms');

// socketio server
const server = http.createServer(app);
const io = socketio(server);

// session
const session = require('express-session')({
  secret: "chat",
  resave: true,
  saveUninitialized: true
});var sharedsession = require("express-socket.io-session");
app.use(session);
io.use(sharedsession(session, {
  autoSave:true
}));

// set static folder
app.use(express.static(path.join(__dirname, 'public')));
// set body-parser
app.use(express.urlencoded({extended: false}));
// parses incoming requests with json payloads to an object
app.use(express.json());

// set view engine
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

const botName = 'ChatApp Bot';

/* ************************************************************ ROUTES ******************************************************* */

// run when client connects
io.on('connection', socket => {

  // join to chatroom
  socket.on('joinRoom', ({ username, room, roomID }) => {
    const userID = socket.handshake.session.userID;
    // const user = userJoin(socket.id, username, room);
    // create user object
    const user = { username, userID, room, roomID };
    // combine userID and roomID and store their relation into db
    joinUsersRoom(user.userID, user.roomID).then(() => {
      // subscribe to a given channel
      socket.join(user.room);
      // welcome current user
      socket.emit('message', formatMessage(botName, 'Welcome to ChatApp!'));
      // broadcast when a user connects
      socket.broadcast.to(user.room).emit('message', formatMessage(botName, `${user.username} has joined the chat`));
      // get the current users in this room from db
      getRoomUsers(user.room).then(users => {
        const usersArr = [];
        users.forEach(user => {
          usersArr.push(user.username);
        });
        // send users and room info
        io.to(user.room).emit('roomUsers', { room: user.room, users: usersArr });
      }).catch(err => {
        console.log(err);
      });
    }).catch(err => {
      console.log(err);
    });  
  });

  // listen for chatMessage
  socket.on('chatMessage', ({ msg, username, room, roomID }) => {
    // const user = getCurrentUser(socket.id);
    const userID = socket.handshake.session.userID;
    const user = { msg, username, userID, room, roomID };
    // save message to db
    insertMessage(user.msg, user.userID, user.roomID).then(() => {
      io.to(user.room).emit('message', formatMessage(user.username, user.msg));
    }).catch(err => {
      console.log(err);
    });
  });

  // runs when client disconnects
  socket.on('disconnect', () => {
    // const user = userLeave(socket.id);
    const user = socket.handshake.session.user;
    const userID = socket.handshake.session.userID;
    getRoomByUserID(userID).then(room => {
      const roomname = room[0].room;
      // deletes user & room correlation from database when user lefts the room
      leaveUsersRoom(userID, room[0].ID).then(() => {
        // get the current users in this room from db
        getRoomUsers(roomname).then(users => {
          const usersArr = [];
          users.forEach(user => {
            usersArr.push(user.username);
          });
          // send info to chatroom that user has left the chat
          io.to(roomname).emit('message', formatMessage(botName, `${user} has left the chat`));
          // send users and room info
          io.to(roomname).emit('roomUsers', { room: roomname, users: usersArr });
        }).catch(err => {
          console.log(err);
        });
      }).catch(err => {
        console.log(err);
      });
    }).catch(err => {
      console.log(err);
    });
  });

});

// route to main
app.get('/', (req, res) => {
  // check if valid user
  if (req.session.user) {
    res.redirect('/room');
  } else {
    res.render('main');
  }
});

// handle with register or login data
app.post('/', (req, res) => {
  const firstname = req.body.firstname;
  const lastname = req.body.lastname;
  const username = req.body.username;
  const email = req.body.email;
  const password = req.body.password;
  const repassword = req.body.repassword;
  // 1 login successful
  // 2 user already exists
  // 3 user not found
  // 4 server error
  // 5 missing entries
  if (firstname && lastname && username && email && password && password === repassword) {
    registerUser(firstname, lastname, username, email, password).then(() => {
      loginUser(username, password).then(user => {
        req.session.user = user.username;
        req.session.userID = user.ID;
        res.json(1);
      }).catch(err => {
        if (err === 3) {
          res.json(3);
        } else {
          res.json(4);
        };
      });  
    }).catch(err => {
      if (err === "exists") {
        res.json(2);
      } else {
        res.json(4);
      };
    });
  } else if (username && password) {
    loginUser(username, password).then(user => {
      req.session.user = user.username;
      req.session.userID = user.ID;
      res.json(1);
    }).catch(err => {
      if (err === 3) {
        res.json(3);
      } else {
        res.json(4);
      };
    });
  } else {
    res.json(5);
  };
});

// route to room
app.get('/room', (req, res) => {
  // check if valid user
  if (req.session.user) {
    // get rooms from db
    getRooms().then(rooms => {
      res.render('room', {rooms});
    }).catch(err => {
      res.redirect('/');
    });
  } else {
    res.redirect('/');
  };
});

// handle with data to create a new chatroom
app.post('/room', (req, res) => {
  // 1 creating a room was successful
  // 2 room already exists
  // 3 creating a room was not successful
  // 4 server error
  if (req.body.roomname) {
    // insert a new room into db
    createRoom(req.body.roomname).then(() => {
      res.json(1);
    }).catch(err => {
      if (err === 'exists') {
        res.json(2);
      } else {
        res.json(3);
      };
    });
  } else {
    res.json(4);
  };
});

// route to chat
app.get('/chat/:room', (req, res) => {
  // check if valid user
  if (req.session.user) {
    if (req.params.room) {
      // get room-element from db
      getRoom(req.params.room).then(room => {
        const roomID = room[0].ID;
        // get history of messages from db
        getMessages(req.params.room).then(messages => {
          const msgs = [];
          messages.forEach(msg => {
            msgs.push({
              username: msg.username,
              text: msg.message,
              time: moment(msg.message_time).format('DD.MM.YY H:mm')
            });
          });
          // render room chat with old messages
          res.render('chat', {username: req.session.user, chatRoom: req.params.room, roomID, oldMessages: JSON.stringify(msgs)});
        }).catch(err => {
          // render room chat without old messages
          res.render('chat', {username: req.session.user, chatRoom: req.params.room, roomID, oldMessages: JSON.stringify([])});
        });
      }).catch(err => {
        console.log(err);
        res.redirect('/room');
      });
    } else {
      res.redirect('/room');
    };
  } else {
    res.redirect('/');
  };
});

// route to logout
app.get('/logout', (req, res) => {
  // destroys the session from user & logs him out
  req.session.destroy();
  res.redirect('/');
});

/* ************************************************************ PORT ******************************************************* */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
