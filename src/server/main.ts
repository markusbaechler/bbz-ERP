import { buildApp } from './app';
import { getPool } from '../db/pool';

const app = buildApp(getPool());
app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
  .then((a) => console.log(`listening on ${a}`));
