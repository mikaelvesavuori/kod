document.querySelectorAll('.copy-install').forEach(function (button) {
  button.addEventListener('click', function () {
    const command = button.closest('.code-block').querySelector('code').innerText;

    navigator.clipboard.writeText(command).then(() => {
      const originalText = button.innerHTML;
      button.innerHTML = 'Copied!';

      setTimeout(() => {
        button.innerHTML = originalText;
      }, 2000);

      if (window.mikro) {
        window.mikro.event('install-command-copied');
      }
    });
  });
});
