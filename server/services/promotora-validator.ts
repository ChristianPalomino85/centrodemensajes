/**
 * Promotora Validator Service
 * Validates if a customer is a registered promotora using SQL Server database
 */

import sql from 'mssql';

const sqlServerConfig: sql.config = {
  user: 'cpalomino',
  password: 'azaleia.2018',
  server: '190.119.245.254',
  database: 'dbbusiness',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
};

export interface PromotoraInfo {
  found: boolean;
  idCliente: string | null;
  razonSocial: string | null;
  documento: string | null;
  tipoDocumento: string | null;
  telefono: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  lider: string | null;
  fechaRegistro: Date | null;
}

/**
 * Validate promotora by phone number
 * Phone should be in format: 51XXXXXXXXX (with country code) or 9XXXXXXXX (without)
 */
export async function validatePromotoraByPhone(phone: string): Promise<PromotoraInfo> {
  console.log(`[PromotoraValidator] Validating by phone: ${phone}`);

  // Normalize phone - remove 51 prefix if present
  let phoneNormalized = phone.replace(/\D/g, ''); // Remove non-digits
  if (phoneNormalized.startsWith('51') && phoneNormalized.length > 9) {
    phoneNormalized = phoneNormalized.substring(2);
  }

  console.log(`[PromotoraValidator] Normalized phone: ${phoneNormalized}`);

  try {
    const pool = await sql.connect(sqlServerConfig);

    const query = `
      SELECT TOP 1
        c.IdCliente,
        c.RazonSocial,
        c.Documento,
        c.TipoDocumento,
        c.TlfCelular,
        u.Departamento,
        u.Provincia,
        u.Distrito,
        l.RazonSocial AS Lider,
        c.FechaRegistro
      FROM DBBUSINESS.DBO.MAECLIENTES c
      LEFT JOIN DBBUSINESS.DBO.UbigeoCourier u ON c.CodUbigeo = u.CodUbigeo
      LEFT JOIN DBBUSINESS.DBO.MAECLIENTES l ON c.IdClienteRef = l.IdCliente
      WHERE c.TlfCelular = @phone
        AND c.FlagActivo = 1
        AND c.FechaRegistro >= '2024-01-01'
      ORDER BY c.FechaRegistro DESC
    `;

    const result = await pool.request()
      .input('phone', sql.VarChar(20), phoneNormalized)
      .query(query);

    await pool.close();

    if (result.recordset.length === 0) {
      console.log(`[PromotoraValidator] No promotora found for phone: ${phoneNormalized}`);
      return {
        found: false,
        idCliente: null,
        razonSocial: null,
        documento: null,
        tipoDocumento: null,
        telefono: null,
        departamento: null,
        provincia: null,
        distrito: null,
        lider: null,
        fechaRegistro: null,
      };
    }

    const row = result.recordset[0];
    console.log(`[PromotoraValidator] Found promotora: ${row.RazonSocial} (${row.IdCliente})`);

    return {
      found: true,
      idCliente: row.IdCliente,
      razonSocial: row.RazonSocial,
      documento: row.Documento,
      tipoDocumento: row.TipoDocumento,
      telefono: row.TlfCelular,
      departamento: row.Departamento,
      provincia: row.Provincia,
      distrito: row.Distrito,
      lider: row.Lider,
      fechaRegistro: row.FechaRegistro,
    };

  } catch (error: any) {
    console.error(`[PromotoraValidator] SQL Error:`, error.message);
    throw error;
  }
}

/**
 * Validate promotora by DNI or RUC
 */
export async function validatePromotoraByDocumento(documento: string): Promise<PromotoraInfo> {
  console.log(`[PromotoraValidator] Validating by documento: ${documento}`);

  // Normalize documento - remove non-digits
  const docNormalized = documento.replace(/\D/g, '');

  try {
    const pool = await sql.connect(sqlServerConfig);

    const query = `
      SELECT TOP 1
        c.IdCliente,
        c.RazonSocial,
        c.Documento,
        c.TipoDocumento,
        c.TlfCelular,
        u.Departamento,
        u.Provincia,
        u.Distrito,
        l.RazonSocial AS Lider,
        c.FechaRegistro
      FROM DBBUSINESS.DBO.MAECLIENTES c
      LEFT JOIN DBBUSINESS.DBO.UbigeoCourier u ON c.CodUbigeo = u.CodUbigeo
      LEFT JOIN DBBUSINESS.DBO.MAECLIENTES l ON c.IdClienteRef = l.IdCliente
      WHERE c.Documento = @documento
        AND c.FlagActivo = 1
        AND c.FechaRegistro >= '2024-01-01'
      ORDER BY c.FechaRegistro DESC
    `;

    const result = await pool.request()
      .input('documento', sql.VarChar(20), docNormalized)
      .query(query);

    await pool.close();

    if (result.recordset.length === 0) {
      console.log(`[PromotoraValidator] No promotora found for documento: ${docNormalized}`);
      return {
        found: false,
        idCliente: null,
        razonSocial: null,
        documento: null,
        tipoDocumento: null,
        telefono: null,
        departamento: null,
        provincia: null,
        distrito: null,
        lider: null,
        fechaRegistro: null,
      };
    }

    const row = result.recordset[0];
    console.log(`[PromotoraValidator] Found promotora: ${row.RazonSocial} (${row.IdCliente})`);

    return {
      found: true,
      idCliente: row.IdCliente,
      razonSocial: row.RazonSocial,
      documento: row.Documento,
      tipoDocumento: row.TipoDocumento,
      telefono: row.TlfCelular,
      departamento: row.Departamento,
      provincia: row.Provincia,
      distrito: row.Distrito,
      lider: row.Lider,
      fechaRegistro: row.FechaRegistro,
    };

  } catch (error: any) {
    console.error(`[PromotoraValidator] SQL Error:`, error.message);
    throw error;
  }
}
