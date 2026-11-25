import { ConfigProvider, Select } from 'antd';

const theme = {
  token: { colorPrimary: '#294cbd', colorText: '#17243a', colorBorder: '#9aacc5', borderRadius: 8 },
  components: { Select: { controlHeight: 44, optionHeight: 38, optionSelectedBg: '#eaf0ff' } },
};

export function AppSelect<T extends string>({ label, value, options, onChange, placeholder, search, disabled }: {
  label: string;
  disabled?: boolean;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
  search?: { value: string; onChange: (value: string) => void; loading: boolean; emptyText: string };
}) {
  return <ConfigProvider theme={theme}>
    <Select<T> aria-label={label} className="app-select" value={value} options={options}
      getPopupContainer={trigger => trigger.closest('dialog') ?? document.body}
      placeholder={placeholder} loading={search?.loading} notFoundContent={search?.emptyText}
      showSearch={search ? { searchValue: search.value, onSearch: search.onChange, filterOption: false } : undefined}
      onChange={onChange} disabled={disabled} virtual={false}/>
  </ConfigProvider>;
}
