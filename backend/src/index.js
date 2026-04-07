import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import mockOracleRoutes from './routes/mockOracleRoutes.js';
import supplierRoutes from './routes/supplierRoutes.js';

const PORT = process.env.PORT || 4050;
const app = express();

/** Default 10mb — Express/body-parser default is 100kb, which breaks large saves (e.g. attachments). */
const JSON_BODY_LIMIT = process.env.BODY_JSON_LIMIT || '10mb';
const URLENCODED_BODY_LIMIT = process.env.BODY_URLENCODED_LIMIT || JSON_BODY_LIMIT;

app.use(cors({ origin: true }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: URLENCODED_BODY_LIMIT }));

app.use('/mock-oracle', mockOracleRoutes);
app.use('/api', routes);
app.use('/api', supplierRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true, port: PORT });
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
