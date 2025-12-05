# Deployment Automático - Configuración

## Overview

El proyecto tiene configurado CI/CD con GitHub Actions para desplegar automáticamente al VPS cuando se hace push a `main`.

## ¿Qué se despliega automáticamente?

### Frontend
- Se compila con `npm run build`
- Se genera en `/opt/flow-builder/dist`

### Backend
- Se actualiza con `git pull`
- Se instalan dependencias
- Se reinicia el servicio con `systemctl restart flowbuilder`

## Configuración Requerida

### Secrets de GitHub

Configura estos secrets en tu repositorio:
**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Descripción | Ejemplo |
|--------|-------------|---------|
| `SSH_HOST` | IP del VPS | `147.93.10.141` |
| `SSH_USERNAME` | Usuario SSH | `root` |
| `SSH_KEY` | Clave privada SSH (formato RSA/PEM) | Contenido de `~/.ssh/id_rsa` |

### Generar clave SSH compatible

```bash
# Generar clave RSA en formato PEM (compatible con GitHub Actions)
ssh-keygen -t rsa -b 4096 -m PEM -f ~/.ssh/github_deploy -N "" -C "github-deploy"

# Agregar la clave pública a authorized_keys
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys

# Mostrar la clave privada (copiar TODO al secret SSH_KEY)
cat ~/.ssh/github_deploy
```

## Servicio systemd

La aplicación corre como servicio systemd: `flowbuilder.service`

### Ubicación del servicio
```
/etc/systemd/system/flowbuilder.service
```

### Comandos útiles
```bash
# Ver estado
systemctl status flowbuilder

# Reiniciar
systemctl restart flowbuilder

# Ver logs
journalctl -u flowbuilder -f

# Ver últimos 100 logs
journalctl -u flowbuilder -n 100
```

## Flujo de Deployment

1. **Push a `main`**
   - Se dispara el workflow automáticamente

2. **GitHub Actions ejecuta:**
   - Checkout del código
   - Instala Node.js 20
   - Instala dependencias
   - Compila frontend (`npm run build`)

3. **Deploy via SSH:**
   - `git pull origin main`
   - `npm install`
   - `npm run build`
   - `systemctl restart flowbuilder`

4. **Aplicación actualizada**

## Verificar que funciona

1. Haz un cambio y push a `main`
2. Ve a GitHub → Actions → Deploy Flow Builder
3. Verifica que todos los pasos sean exitosos
4. En el servidor: `systemctl status flowbuilder`

## Troubleshooting

### Error: "ssh: no key found"
- La clave SSH debe estar en formato RSA/PEM (BEGIN RSA PRIVATE KEY)
- No uses formato OpenSSH nuevo (BEGIN OPENSSH PRIVATE KEY)
- Genera una nueva clave con: `ssh-keygen -t rsa -b 4096 -m PEM`

### Error: "Permission denied"
- Verifica que la clave pública esté en `~/.ssh/authorized_keys`
- Verifica permisos: `chmod 600 ~/.ssh/authorized_keys`

### Error: "npm: command not found"
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Ver logs del deploy en el servidor
```bash
journalctl -u flowbuilder -n 50
```

## Deployment Manual (Fallback)

Si el CI/CD falla:

```bash
cd /opt/flow-builder
git pull origin main
npm install
npm run build
systemctl restart flowbuilder
```

## Notas Importantes

- El deployment solo ocurre en push a `main`
- Asegúrate de que `.env` esté en el VPS (no se sube por seguridad)
- Las dependencias nuevas se instalan automáticamente
