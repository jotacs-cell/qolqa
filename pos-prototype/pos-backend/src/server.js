require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API del sistema de ventas escuchando en el puerto ${PORT}`);
});
