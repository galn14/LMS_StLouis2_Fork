
const bcrypt = require('bcryptjs');
const password = 'password';
const saltRounds = 12;
bcrypt.hash(password, saltRounds, function(err, hash) {
    if (err) {
        console.error(err);
        return;
    }
    console.log(hash);
});
