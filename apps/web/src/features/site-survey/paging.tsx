import { useTranslations } from 'use-intl';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/i18n/format';
export function SurveyPaging({ offset, limit, total, disabled, change }: {
  offset: number; limit: number; total: number; disabled: boolean; change: (offset: number) => void;
}) {
  const t = useTranslations('siteSurvey'), format = useFormat();
  return <nav aria-label={t('pagination')} className="flex min-w-0 flex-wrap items-center justify-between gap-3">
    <p className="text-sm">{t('recordCount', { total: format.number(total) })}</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || offset === 0} onClick={() => change(Math.max(0, offset - limit))}>{t('previous')}</Button>
      <Button variant="outline" disabled={disabled || offset + limit >= total} onClick={() => change(offset + limit)}>{t('next')}</Button></div>
  </nav>;
}
