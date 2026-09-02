require('dotenv').config();
const app = require('./app');

const PUERTO = process.env.PORT || 4000;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en tu .env — copia .env.example y complétalo.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.error('Falta JWT_SECRET en tu .env — usa una cadena aleatoria larga, no un valor de ejemplo.');
  process.exit(1);
}

app.listen(PUERTO, () => {
  console.log(`Qolqa API escuchando en http://localhost:${PUERTO}`);
});
