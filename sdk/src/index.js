module.exports = require("./client");
module.exports = {
  ...require("./client"),
  ...require("./local-client"),
};