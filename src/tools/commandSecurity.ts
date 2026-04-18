const DANGEROUS_KEYWORDS = ['destroy', 'truncate', 'drop', 'purge'];

const BLOCKED_PATTERNS = [
  'gsutil rb',
  'gsutil rm -r',
  'gsutil rm -R',
  'gsutil rm gs://',
  'gcloud storage buckets delete',
  'gcloud storage rm',
  'gcloud firestore databases delete',
  'gcloud firestore delete',
  'firebase firestore:delete',
  'firebase firestore:clear',
  'firebase firestore:reset',
  'gcloud run services delete',
  'gcloud run revisions delete',
  'gcloud functions delete',
  'gcloud app services delete',
  'gcloud app versions delete',
  'gcloud compute instances delete',
  'gcloud compute instance-groups managed delete',
  'gcloud container clusters delete',
  'gcloud sql instances delete',
  'gcloud sql databases delete',
  'gcloud sql users delete',
  'gcloud projects remove-iam-policy-binding',
  'gcloud iam service-accounts delete',
  'gcloud iam roles delete',
  'gcloud kms keyrings delete',
  'gcloud kms keys delete',
  'gcloud secrets delete',
  'gcloud secrets versions destroy',
  'terraform destroy',
  'terraform apply -destroy',
  'rm -rf',
  'rm -r',
  'rm -R',
  'chmod -R',
  'chown -R',
  'dd if=',
  'mkfs',
  'wipefs',
  'shutdown',
  'reboot',
] as const;

export function getBlockedCommandReason(command: string): string | null {
  const normalizedCommand = command.trim().toLowerCase();
  const tokens = normalizedCommand.split(/\s+/);

  for (const token of tokens) {
    if (DANGEROUS_KEYWORDS.includes(token)) {
      return `Comandos contendo a palavra '${token}' são bloqueados por segurança.`;
    }
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (normalizedCommand.startsWith(pattern)) {
      return `O padrão de comando '${pattern}' é bloqueado por segurança.`;
    }
  }

  if (
    normalizedCommand.includes('terraform') &&
    normalizedCommand.includes('apply') &&
    normalizedCommand.includes('-auto-approve')
  ) {
    return `O comando 'terraform apply -auto-approve' é bloqueado por segurança.`;
  }

  if (normalizedCommand.includes('force')) {
    return "Comandos contendo a palavra 'force' não são permitidos.";
  }

  return null;
}
